import { ConfigurationManager } from '@duradav/backend-runtime/config';
import { RepositoryDAO, TokenRepoGrantDAO, UserAccessTokenDAO } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError, UnauthorizedError } from '@duradav/backend-errors';
import type { TokenScope, TokenRepoGrantMetadata, UserAccessTokenMetadata } from '@duradav/shared';
import { TimestampUtil, UUIDUtil, CryptoUtil, mapWithConcurrency } from '@duradav/shared/utils';
import { DEFAULT_TOKEN_SCOPES, TOKEN_SCOPES, coversScope, normalizeTokenScopes } from './TokenScopes';

interface TokenServiceEnv {
  DB: D1Queryable;
  MAX_TOKENS_PER_USER?: string;
  MAX_TOKEN_EXPIRY_DAYS?: string;
  MAX_TOKEN_REPO_GRANTS?: string;
}

interface CreatedToken {
  tokenId: string;
  token: string;
  name: string;
  expiresAt: number;
  scopes: TokenScope[];
  prefix: string;
}

interface RepoGrantInput {
  repositoryId: string;
  scope: TokenScope;
}

interface AuthenticatedToken {
  email: string;
  scopes: TokenScope[];
  tokenId: string;
  repoGrants: RepoGrantInput[];
}

interface TokenServiceDeps {
  tokenDAO?: () => Promise<UserAccessTokenDAO>;
  repositoryDAO?: () => Promise<RepositoryDAO>;
  tokenGrantDAO?: () => Promise<TokenRepoGrantDAO>;
}

function tokenPrefixOf(token: string): string {
  return token.slice(0, 12);
}

class TokenService {
  private readonly deps: Required<TokenServiceDeps>;

  constructor(
    private readonly env: TokenServiceEnv,
    deps: TokenServiceDeps = {},
  ) {
    this.deps = {
      tokenDAO: () => Promise.resolve(new UserAccessTokenDAO(env.DB)),
      repositoryDAO: () => Promise.resolve(new RepositoryDAO(env.DB)),
      tokenGrantDAO: () => Promise.resolve(new TokenRepoGrantDAO(env.DB)),
      ...deps,
    };
  }

  public static async hashToken(token: string): Promise<string> {
    return CryptoUtil.sha256Hex(`duradav-pat:${token}`);
  }

  public async authenticateWithPAT(token: string): Promise<AuthenticatedToken> {
    const dao = await this.deps.tokenDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const tokenHash = await TokenService.hashToken(token);
    const tokenData: UserAccessTokenMetadata | undefined = await dao.getByTokenHash(tokenHash, now);
    if (tokenData) {
      // Best-effort touch: D1 transient failure must not deny a valid token.
      await dao.updateLastUsedByHash(tokenHash, now).catch(() => undefined);
      // Fail closed: if the grant list cannot be read, deny rather than
      // treating a scoped token as unrestricted (previous `.catch(() => [])`
      // fail-open). A scoped token with unreadable grants must not escalate.
      let grants: Array<{ repository_id: string; scope: TokenScope }>;
      try {
        grants = await this.deps.tokenGrantDAO().then((d) => d.listByToken(tokenData.tokenId));
      } catch {
        throw new UnauthorizedError('Your personal access token is temporarily unavailable.');
      }
      return {
        email: tokenData.userEmail.toLowerCase(),
        scopes: tokenData.scopes,
        tokenId: tokenData.tokenId,
        repoGrants: grants.map((g) => ({ repositoryId: g.repository_id, scope: g.scope })),
      };
    }
    throw new UnauthorizedError('Your personal access token is invalid or has expired.');
  }

  public static coversScope(held: readonly TokenScope[], required: TokenScope): boolean {
    return coversScope(held, required);
  }

  private async resolveGrantInputs(grants: unknown): Promise<RepoGrantInput[]> {
    if (grants === undefined || grants === null) return [];
    if (!Array.isArray(grants)) throw new BadRequestError('repoGrants must be an array of {owner, name, scope}');
    const max = ConfigurationManager.transfer.getMaxTokenRepoGrants(this.env);
    if (grants.length > max) throw new BadRequestError(`At most ${max} repository grants per token`);
    // Validate shapes first (fail fast without D1), then batch repo lookups
    // concurrently (was sequential N+1).
    const parsed = grants.map((entry) => {
      const owner = typeof (entry as { owner?: unknown }).owner === 'string' ? (entry as { owner: string }).owner.trim() : '';
      const rawName = typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name.trim() : '';
      const name = rawName.toLowerCase().endsWith('.git') ? rawName.slice(0, -4) : rawName;
      if (!owner || !name) throw new BadRequestError('Each repoGrant needs owner and name');
      const scope = (entry as { scope?: unknown }).scope;
      if (typeof scope !== 'string' || !(TOKEN_SCOPES as readonly string[]).includes(scope)) {
        throw new BadRequestError(`Each repoGrant scope must be one of ${TOKEN_SCOPES.join(', ')}`);
      }
      return { owner, name, scope: scope as TokenScope };
    });
    const repoDAO = await this.deps.repositoryDAO();
    // Fail closed: null means missing repo; `DatabaseError` (outage) propagates.
    const repos = await mapWithConcurrency(parsed, 10, (p) => repoDAO.getByOwnerAndName(p.owner, p.name));
    const resolved: RepoGrantInput[] = [];
    const seen = new Set<string>();
    for (const [i, p] of parsed.entries()) {
      const repo = repos.at(i);
      if (!repo) throw new NotFoundError('Repository not found');
      if (seen.has(repo.id)) throw new BadRequestError(`Duplicate grant for ${p.owner}/${p.name}`);
      seen.add(repo.id);
      resolved.push({ repositoryId: repo.id, scope: p.scope });
    }
    return resolved;
  }

  public async createToken(
    userEmail: string,
    name: string,
    expiresInDays?: unknown,
    scopes?: unknown,
    repoGrants?: unknown,
  ): Promise<CreatedToken> {
    const dao = await this.deps.tokenDAO();
    const normalized = userEmail.toLowerCase();
    const maxTokens: number = ConfigurationManager.token.getMaxPerUser(this.env);
    const maxExpiryInDays: number = ConfigurationManager.token.getMaxExpiryDays(this.env);
    const existingTokens: UserAccessTokenMetadata[] = await dao.getByUserEmail(normalized);
    if (existingTokens.length >= maxTokens) {
      throw new BadRequestError(`Maximum ${maxTokens} tokens allowed per user`);
    }
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) throw new BadRequestError('name is required');
    if (trimmedName.length > 100) throw new BadRequestError('name must be at most 100 characters');
    let effectiveExpiryInDays: number;
    if (expiresInDays === undefined || expiresInDays === null) {
      effectiveExpiryInDays = maxExpiryInDays;
    } else {
      // Strict numeric-string handling: only clean integer strings coerce
      // (matches DeployKeyService's reject-non-number posture for real
      // numbers while tolerating JSON clients that send "30").
      let numeric: unknown = expiresInDays;
      if (typeof expiresInDays === 'string') {
        const trimmed = expiresInDays.trim();
        if (!/^\d+$/.test(trimmed)) {
          throw new BadRequestError('expiresInDays must be a positive integer');
        }
        numeric = Number(trimmed);
      }
      if (!Number.isSafeInteger(numeric) || (numeric as number) < 1) {
        throw new BadRequestError('expiresInDays must be a positive integer');
      }
      const days = numeric as number;
      if (days > maxExpiryInDays) {
        throw new BadRequestError(`Token expiry cannot exceed ${maxExpiryInDays} days`);
      }
      effectiveExpiryInDays = days;
    }
    const effectiveScopes: TokenScope[] = scopes === undefined ? [...DEFAULT_TOKEN_SCOPES] : normalizeTokenScopes(scopes);
    const resolvedGrants = await this.resolveGrantInputs(repoGrants);
    const tokenId: string = UUIDUtil.getRandomUUID();
    const token: string = UUIDUtil.getRandomUUIDNoDash() + UUIDUtil.getRandomUUIDNoDash();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const expiresAt: number = TimestampUtil.addDays(now, effectiveExpiryInDays);
    const tokenHash = await TokenService.hashToken(token);
    const prefix = tokenPrefixOf(token);
    await dao.create(tokenId, normalized, tokenHash, trimmedName, expiresAt, now, effectiveScopes, prefix);
    // Post-create single-flight: two concurrent creates can both pass the
    // pre-check. If we lost the race and exceeded the cap, roll back our own
    // token so MAX_TOKENS_PER_USER holds under concurrency.
    try {
      const after = await dao.getByUserEmail(normalized);
      if (after.length > maxTokens) {
        await dao.delete(tokenId, normalized).catch(() => undefined);
        throw new BadRequestError(`Maximum ${maxTokens} tokens allowed per user`);
      }
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      // Count lookup failure must not fail the mint itself (mint succeeds;
      // the outage is intentionally not propagated so a transient read
      // failure cannot block issuance).
    }
    if (resolvedGrants.length > 0) {
      const grantDAO = await this.deps.tokenGrantDAO();
      try {
        await grantDAO.setGrants(tokenId, resolvedGrants, now);
      } catch (error) {
        // Fail closed: a scoped token whose grants cannot persist must not
        // silently become unrestricted. Best-effort rollback then throw so
        // the caller sees 500 (masked) instead of a full-access token.
        // `cause` preserves the D1 outage stack (why: bare `new Error` lost it).
        await dao.delete(tokenId, normalized).catch(() => undefined);
        throw new Error('Failed to persist repository grants for token', { cause: error });
      }
    }
    return { tokenId, token, name: trimmedName, expiresAt, scopes: effectiveScopes, prefix };
  }

  public async listTokens(userEmail: string): Promise<UserAccessTokenMetadata[]> {
    const dao = await this.deps.tokenDAO();
    const tokens = await dao.getByUserEmail(userEmail.toLowerCase());
    if (tokens.length === 0) return [];
    const grantDAO = await this.deps.tokenGrantDAO();
    const repoDAO = await this.deps.repositoryDAO();
    // Perf: concurrent grant + repo fan-out (was sequential N+1: up to
    // 5 tokens x 50 grants = 250 D1 round-trips). Fail-closed on grants.
    const grantsByToken = await Promise.all(tokens.map((t) => grantDAO.listByToken(t.tokenId)));
    const allRepoIds = [...new Set(grantsByToken.flat().map((g) => g.repository_id))];
    const repoById = new Map<string, { owner: string; name: string }>();
    await Promise.all(
      allRepoIds.map(async (id) => {
        const repo = await repoDAO.getById(id).catch(() => null);
        if (repo) repoById.set(id, { owner: repo.owner, name: repo.name });
      }),
    );
    return tokens.map((token, i) => {
      const detailed: TokenRepoGrantMetadata[] = [];
      const grants = grantsByToken.at(i) ?? [];
      for (const grant of grants) {
        const repo = repoById.get(grant.repository_id);
        if (!repo) continue;
        detailed.push({
          tokenId: grant.token_id,
          repositoryId: grant.repository_id,
          owner: repo.owner,
          name: repo.name,
          fullName: `${repo.owner}/${repo.name}`,
          scope: grant.scope,
        });
      }
      return { ...token, repoGrants: detailed };
    });
  }

  private async grantMetadata(
    repoDAO: RepositoryDAO,
    grant: { token_id: string; repository_id: string; scope: TokenScope },
  ): Promise<TokenRepoGrantMetadata | null> {
    const repo = await repoDAO.getById(grant.repository_id).catch(() => null);
    if (!repo) return null;
    return {
      tokenId: grant.token_id,
      repositoryId: grant.repository_id,
      owner: repo.owner,
      name: repo.name,
      fullName: `${repo.owner}/${repo.name}`,
      scope: grant.scope,
    };
  }

  public async rotateToken(tokenId: string, userEmail: string): Promise<{ token: string; expiresAt: number; prefix: string }> {
    const dao = await this.deps.tokenDAO();
    const normalized = userEmail.toLowerCase();
    const tokens = await dao.getByUserEmail(normalized);
    const existing = tokens.find((t) => t.tokenId === tokenId);
    if (!existing) throw new NotFoundError('Token not found');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    if (existing.expiresAt <= now) throw new BadRequestError('Token has expired and cannot be rotated; create a new token');
    const maxExpiry = ConfigurationManager.token.getMaxExpiryDays(this.env);
    const lifetimeDays = Math.min(Math.max(Math.round((existing.expiresAt - existing.createdAt) / 86_400), 1), maxExpiry);
    const raw = UUIDUtil.getRandomUUIDNoDash() + UUIDUtil.getRandomUUIDNoDash();
    const rotated = await dao.rotate(
      tokenId,
      normalized,
      await TokenService.hashToken(raw),
      tokenPrefixOf(raw),
      TimestampUtil.addDays(now, lifetimeDays),
    );
    if (!rotated) throw new NotFoundError('Token not found');
    const current = await dao.getByUserEmail(normalized);
    const refreshed = current.find((t) => t.tokenId === tokenId);
    return { token: raw, expiresAt: refreshed?.expiresAt ?? TimestampUtil.addDays(now, lifetimeDays), prefix: tokenPrefixOf(raw) };
  }

  public async deleteToken(tokenId: string, userEmail: string): Promise<void> {
    const dao = await this.deps.tokenDAO();
    const deleted = await dao.delete(tokenId, userEmail.toLowerCase());
    if (!deleted) throw new NotFoundError('Token not found');
    await this.deps.tokenGrantDAO().then((d) => d.deleteByToken(tokenId).catch(() => undefined));
    // Junction cleanup mirrors the grant cleanup above (never throws: the
    // row is already gone, orphans are inert until the drop migration).
    if (typeof dao.deleteScopes === 'function') {
      await dao.deleteScopes(tokenId).catch(() => undefined);
    }
  }
}

export { TokenService };
export type { CreatedToken, AuthenticatedToken, RepoGrantInput, TokenServiceDeps, TokenServiceEnv };
