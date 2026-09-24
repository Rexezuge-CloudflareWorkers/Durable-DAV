import { jwtVerify, createRemoteJWKSet } from 'jose';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import { UnauthorizedError } from '@duradav/backend-errors';
import { DEMO_USER_EMAIL } from '@duradav/shared/constants';
import { isValidEmailFormat } from '@duradav/shared/utils';

interface AccessAuthEnv {
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  DEV_AUTH_EMAIL?: string;
  DEMO_MODE?: string;
  ENVIRONMENT?: string;
}

interface AccessIdentityContext {
  access?: {
    getIdentity: () => Promise<{ email?: string | null; emailVerified?: boolean | null; email_verified?: boolean | null } | null>;
  };
}

type AccessAuthStrategy = (env: AccessAuthEnv, request: Request, accessCtx?: AccessIdentityContext) => Promise<string | null>;

function isBypassAllowed(env: AccessAuthEnv): boolean {
  return ConfigurationManager.auth.isBypassAllowed(env);
}

function demoModeStrategy(env: AccessAuthEnv): Promise<string | null> {
  if (!isBypassAllowed(env)) return Promise.resolve(null);
  return Promise.resolve(ConfigurationManager.auth.isDemoMode(env) ? DEMO_USER_EMAIL : null);
}

function isValidAuthEmail(raw: string): boolean {
  if (!raw || /\s/.test(raw)) return false;
  return isValidEmailFormat(raw);
}

function devEmailStrategy(env: AccessAuthEnv): Promise<string | null> {
  if (!isBypassAllowed(env)) return Promise.resolve(null);
  const raw = env.DEV_AUTH_EMAIL?.trim() ?? '';
  if (!raw) return Promise.resolve(null);
  // Fail closed on malformed bypass emails — fall through to JWT instead of
  // authenticating an invalid identity.
  if (!isValidAuthEmail(raw)) return Promise.resolve(null);
  return Promise.resolve(raw.toLowerCase());
}

async function accessJwtStrategy(env: AccessAuthEnv, request: Request): Promise<string | null> {
  if (env.TEAM_DOMAIN && env.POLICY_AUD) {
    // Fail soft so the `ctx.access` fallback stays reachable when the JWT is
    // missing/invalid. `getAuthenticatedUserEmail` throws once no strategy
    // matches — a single throw site instead of one per strategy.
    try {
      return await AccessAuthService.verifyAccessJwt(request, env.TEAM_DOMAIN, env.POLICY_AUD);
    } catch {
      return null;
    }
  }
  return null;
}

async function accessCtxStrategy(_env: AccessAuthEnv, _request: Request, accessCtx?: AccessIdentityContext): Promise<string | null> {
  const identity = await accessCtx?.access?.getIdentity?.().catch(() => null);
  // Fail closed on unverified identities — mirrors the JWT path's
  // `email_verified === false` reject. Access bindings are trusted, but an
  // unverified identity must never authenticate.
  if (identity?.emailVerified === false || identity?.email_verified === false) return null;
  const raw = identity?.email?.trim().toLowerCase() ?? '';
  if (!isValidAuthEmail(raw)) return null;
  return raw;
}

const DEFAULT_ACCESS_AUTH_STRATEGIES: readonly AccessAuthStrategy[] = [
  demoModeStrategy,
  devEmailStrategy,
  accessJwtStrategy,
  accessCtxStrategy,
];

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.codePointAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

class AccessAuthService {
  private static readonly jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  private static jwksFor(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
    const normalized = trimTrailingSlashes(teamDomain.trim().toLowerCase());
    const cached = this.jwksCache.get(normalized);
    if (cached) {
      this.jwksCache.delete(normalized);
      this.jwksCache.set(normalized, cached);
      return cached;
    }
    const created = createRemoteJWKSet(new URL(`${normalized}/cdn-cgi/access/certs`));
    // Bound the cache so distinct team domains cannot grow it without limit.
    // Evict the oldest entry (LRU-ish) instead of clearing everything so an
    // attacker cycling domains cannot flush legitimate entries (DoS).
    if (this.jwksCache.size >= 10) {
      const oldest = this.jwksCache.keys().next().value;
      if (oldest !== undefined) this.jwksCache.delete(oldest);
    }
    this.jwksCache.set(normalized, created);
    return created;
  }
  private readonly strategies: readonly AccessAuthStrategy[];

  constructor(
    private readonly env: AccessAuthEnv,
    strategies: readonly AccessAuthStrategy[] = DEFAULT_ACCESS_AUTH_STRATEGIES,
  ) {
    this.strategies = strategies;
  }

  public async getAuthenticatedUserEmail(request: Request, accessCtx?: AccessIdentityContext): Promise<string> {
    for (const strategy of this.strategies) {
      const email = await strategy(this.env, request, accessCtx);
      if (email) {
        return email;
      }
    }
    // Single throw site: the JWT strategy already attempted verification and
    // failed soft, so re-verifying here would only double the JWK fetch.
    throw new UnauthorizedError('Cloudflare Access authentication failed.');
  }

  public static async verifyAccessJwt(request: Request, teamDomain?: string, policyAud?: string): Promise<string> {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) {
      throw new UnauthorizedError('No Cloudflare Access JWT token provided in request headers.');
    }

    if (!teamDomain || !policyAud) {
      throw new UnauthorizedError('Missing required JWT verification configuration.');
    }

    // Single trailing-slash normalizer (Strategy/Policy reuse): domain casing
    // is normalized, audience stays case-sensitive per JWT spec.
    const normalizedTeamDomain = trimTrailingSlashes(teamDomain.trim()).toLowerCase();
    const normalizedPolicyAud: string = policyAud.trim();
    if (!normalizedPolicyAud) {
      throw new UnauthorizedError('Missing required JWT verification configuration.');
    }
    if (normalizedPolicyAud.includes(',')) {
      throw new UnauthorizedError('Multiple JWT audiences are not supported. Configure a single POLICY_AUD value.');
    }

    try {
      const JWKS = this.jwksFor(normalizedTeamDomain);
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: normalizedTeamDomain,
        audience: normalizedPolicyAud,
      });

      if (payload.email_verified === false) {
        throw new UnauthorizedError('Cloudflare Access authentication failed.');
      }
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
      if (!isValidAuthEmail(email)) {
        throw new UnauthorizedError('Cloudflare Access authentication failed.');
      }
      return email;
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError('Cloudflare Access authentication failed.');
    }
  }
}

export { AccessAuthService, DEFAULT_ACCESS_AUTH_STRATEGIES };
export type { AccessAuthEnv, AccessIdentityContext, AccessAuthStrategy };
