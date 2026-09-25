import { ConfigurationManager } from '@durable-dav/backend-runtime/config';
import {
  DavVolumeDAO,
  TokenVolumeGrantDAO,
  UserAccessTokenDAO,
} from '@durable-dav/backend-data/dao';
import type { D1Queryable } from '@durable-dav/backend-data/utils';
import { BadRequestError, NotFoundError, UnauthorizedError } from '@durable-dav/backend-errors';
import type {
  TokenScope,
  TokenVolumeGrantMetadata,
  UserAccessTokenMetadata,
} from '@durable-dav/shared';
import { TimestampUtil, UUIDUtil, CryptoUtil, mapWithConcurrency } from '@durable-dav/shared/utils';
import { DEFAULT_TOKEN_SCOPES, TOKEN_SCOPES, coversScope, normalizeTokenScopes } from './TokenScopes';

interface TokenServiceEnv {
  DB: D1Queryable;
  MAX_TOKENS_PER_USER?: string;
  MAX_TOKEN_EXPIRY_DAYS?: string;
  MAX_TOKEN_VOLUME_GRANTS?: string;
}

interface CreatedToken {
  tokenId: string;
  token: string;
  name: string;
  expiresAt: number;
  scopes: TokenScope[];
  prefix: string;
}

interface VolumeGrantInput {
  volumeId: string;
  scope: TokenScope;
}

interface AuthenticatedToken {
  email: string;
  scopes: TokenScope[];
  tokenId: string;
  volumeGrants: VolumeGrantInput[];
}

interface TokenServiceDeps {
  tokenDAO?: () => Promise<UserAccessTokenDAO>;
  volumeDAO?: () => Promise<DavVolumeDAO>;
  tokenVolumeGrantDAO?: () => Promise<TokenVolumeGrantDAO>;
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
      volumeDAO: () => Promise.resolve(new DavVolumeDAO(env.DB)),
      tokenVolumeGrantDAO: () => Promise.resolve(new TokenVolumeGrantDAO(env.DB)),
      ...deps,
    };
  }

  public static async hashToken(token: string): Promise<string> {
    return CryptoUtil.sha256Hex(`durable-dav-pat:${token}`);
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
      // treating a scoped token as unrestricted. Unscoped tokens (empty
      // list) keep full access per bucket policy.
      let volumeGrants: Array<{ volume_id: string; scope: TokenScope }>;
      try {
        volumeGrants = await this.deps.tokenVolumeGrantDAO().then((d) => d.listByToken(tokenData.tokenId));
      } catch {
        throw new UnauthorizedError('Your personal access token is temporarily unavailable.');
      }
      return {
        email: tokenData.userEmail.toLowerCase(),
        scopes: tokenData.scopes,
        tokenId: tokenData.tokenId,
        volumeGrants: volumeGrants.map((g) => ({ volumeId: g.volume_id, scope: g.scope })),
      };
    }
    throw new UnauthorizedError('Your personal access token is invalid or has expired.');
  }

  public static coversScope(held: readonly TokenScope[], required: TokenScope): boolean {
    return coversScope(held, required);
  }

  public static coversVolumeGrant(
    grants: readonly VolumeGrantInput[],
    volumeId: string,
    required: TokenScope,
  ): boolean {
    // Empty grant list = unrestricted (full access); non-empty requires a
    // matching volume grant whose scope covers the requirement.
    if (grants.length === 0) return true;
    return grants.some((g) => g.volumeId === volumeId && coversScope([g.scope], required));
  }

  private async resolveVolumeGrantInputs(grants: unknown): Promise<VolumeGrantInput[]> {
    if (grants === undefined || grants === null) return [];
    if (!Array.isArray(grants)) throw new BadRequestError('volumeGrants must be an array of {owner, name, scope}');
    const max = ConfigurationManager.transfer.getMaxTokenVolumeGrants(this.env);
    if (grants.length > max) throw new BadRequestError(`At most ${max} volume grants per token`);
    const allowedScopes = new Set<string>([...TOKEN_SCOPES, 'repo:read', 'repo:write']);
    const parsed = grants.map((entry) => {
      const owner = typeof (entry as { owner?: unknown }).owner === 'string' ? (entry as { owner: string }).owner.trim() : '';
      const name = typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name.trim() : '';
      if (!owner || !name) throw new BadRequestError('Each volumeGrant needs owner and name');
      const scope = (entry as { scope?: unknown }).scope;
      if (typeof scope !== 'string' || !allowedScopes.has(scope)) {
        throw new BadRequestError(`Each volumeGrant scope must be one of ${TOKEN_SCOPES.join(', ')}`);
      }
      return { owner, name, scope: scope as TokenScope };
    });
    const volumeDAO = await this.deps.volumeDAO();
    const volumes = await mapWithConcurrency(parsed, 10, (p) => volumeDAO.getByOwnerName(p.owner, p.name));
    const resolved: VolumeGrantInput[] = [];
    const seen = new Set<string>();
    for (const [i, p] of parsed.entries()) {
      const volume = volumes.at(i);
      if (!volume) throw new NotFoundError('Volume not found');
      if (seen.has(volume.id)) throw new BadRequestError(`Duplicate grant for ${p.owner}/${p.name}`);
      seen.add(volume.id);
      resolved.push({ volumeId: volume.id, scope: p.scope });
    }
    return resolved;
  }

  public async createToken(
    userEmail: string,
    name: string,
    expiresInDays?: unknown,
    scopes?: unknown,
    volumeGrants?: unknown,
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
      // (tolerates JSON clients that send "30").
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
    const resolvedVolumeGrants = await this.resolveVolumeGrantInputs(volumeGrants);
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
    if (resolvedVolumeGrants.length > 0) {
      const volumeGrantDAO = await this.deps.tokenVolumeGrantDAO();
      try {
        await volumeGrantDAO.setGrants(tokenId, resolvedVolumeGrants, now);
      } catch (error) {
        // Fail closed: a scoped token whose grants cannot persist must not
        // silently become unrestricted. Best-effort rollback then throw so
        // the caller sees 500 (masked) instead of a full-access token.
        await dao.delete(tokenId, normalized).catch(() => undefined);
        throw new Error('Failed to persist volume grants for token', { cause: error });
      }
    }
    return { tokenId, token, name: trimmedName, expiresAt, scopes: effectiveScopes, prefix };
  }

  public async listTokens(userEmail: string): Promise<UserAccessTokenMetadata[]> {
    const dao = await this.deps.tokenDAO();
    const tokens = await dao.getByUserEmail(userEmail.toLowerCase());
    if (tokens.length === 0) return [];
    const volumeGrantDAO = await this.deps.tokenVolumeGrantDAO();
    const volumeDAO = await this.deps.volumeDAO();
    // Perf: concurrent grant fan-out. Fail-closed on grants.
    const volumeGrantsByToken = await Promise.all(tokens.map((t) => volumeGrantDAO.listByToken(t.tokenId)));
    const allVolumeIds = [...new Set(volumeGrantsByToken.flat().map((g) => g.volume_id))];
    const volumeById = new Map<string, { owner: string; name: string }>();
    await Promise.all(
      allVolumeIds.map(async (id) => {
        const volume = await volumeDAO.getById(id).catch(() => null);
        if (volume) volumeById.set(id, { owner: volume.owner, name: volume.name });
      }),
    );
    return tokens.map((token, i) => {
      const volumeDetailed: TokenVolumeGrantMetadata[] = [];
      const volumeGrants = volumeGrantsByToken[i] ?? [];
      for (const grant of volumeGrants) {
        const volume = volumeById.get(grant.volume_id);
        if (!volume) continue;
        volumeDetailed.push({
          tokenId: grant.token_id,
          volumeId: grant.volume_id,
          owner: volume.owner,
          name: volume.name,
          fullName: `${volume.owner}/${volume.name}`,
          scope: grant.scope,
        });
      }
      return { ...token, volumeGrants: volumeDetailed };
    });
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
    await this.deps.tokenVolumeGrantDAO().then((d) => d.deleteByToken(tokenId).catch(() => undefined));
    // Junction cleanup mirrors the grant cleanup above (never throws: the
    // row is already gone, orphans are inert).
    if (typeof dao.deleteScopes === 'function') {
      await dao.deleteScopes(tokenId).catch(() => undefined);
    }
  }
}

export { TokenService };
export type { CreatedToken, AuthenticatedToken, VolumeGrantInput, TokenServiceDeps, TokenServiceEnv };
