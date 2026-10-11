import { AccessAuthError, authenticateAccess } from '@rexezuge/http';
import type { AccessBinding } from '@rexezuge/http';
import { AppConfiguration } from '@durable-dav/backend-runtime/config';
import { UnauthorizedError } from '@rexezuge/errors';
import { DEMO_USER_EMAIL } from '@durable-dav/shared/constants';
import { isValidEmailFormat } from '@rexezuge/shared';

interface AccessAuthEnv {
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  DEV_AUTH_EMAIL?: string;
  DEMO_MODE?: string;
  DEMO_USER_EMAIL?: string;
  ENVIRONMENT?: string;
}

interface AccessIdentityContext {
  access?: {
    getIdentity: () => Promise<{ email?: string | null; emailVerified?: boolean | null; email_verified?: boolean | null } | null>;
  };
}

function isValidAuthEmail(raw: string): boolean {
  return raw !== '' && !/\s/.test(raw) && isValidEmailFormat(raw);
}

/**
 * `/user/*` identity: DEMO_MODE → DEV_AUTH_EMAIL → JWT
 * (`cf-access-jwt-assertion` vs TEAM_DOMAIN/POLICY_AUD) → platform-identity
 * fallback. Never trust `Cf-Access-Authenticated-User-Email`.
 *
 * A thin adapter over the kit's `authenticateAccess` (`@rexezuge/http`): the
 * strategy ordering, the fail-soft JWT → binding fallthrough, the unverified-
 * identity rejection and the JWKS cache all live there now, converged from the
 * four copies this repo's version was one of. What stays here is the wiring
 * only: building the kit's options from `AppConfiguration`, adapting the
 * platform-identity context shape this worker passes, and translating the
 * kit's `AccessAuthError` into the `UnauthorizedError` the middleware maps to
 * a 401.
 */
class AccessAuthService {
  constructor(private readonly env: AccessAuthEnv) {}

  public async getAuthenticatedUserEmail(request: Request, accessCtx?: AccessIdentityContext): Promise<string> {
    const config = AppConfiguration.fromEnv(this.env);
    // `DEMO_USER_EMAIL` wins over the constant. A malformed override falls back
    // to the constant rather than being trusted, matching the dev-email path's
    // fail-closed rule below (the kit itself trusts whatever it is given).
    const configured = config.getDemoUserEmail()?.trim() ?? '';
    const binding: AccessBinding | undefined = accessCtx?.access
      ? {
          getIdentity: async () => {
            const identity = await accessCtx.access?.getIdentity().catch(() => null);
            return identity ?? undefined;
          },
        }
      : undefined;
    try {
      return await authenticateAccess(request, binding, {
        bypassAllowed: config.isBypassAllowed(),
        isDemoMode: config.isDemoMode(),
        demoUserEmail: configured && isValidAuthEmail(configured) ? configured.toLowerCase() : DEMO_USER_EMAIL,
        devAuthEmail: config.getDevAuthEmail(),
        teamDomain: config.getTeamDomain(),
        policyAud: config.getPolicyAud(),
      });
    } catch (error: unknown) {
      // Single throw site: the kit already attempted verification and failed
      // soft through every strategy, so re-verifying here would only double the
      // JWK fetch. The error is re-typed, not re-derived.
      if (error instanceof AccessAuthError) throw new UnauthorizedError(error.message);
      throw error;
    }
  }

  public static async verifyAccessJwt(request: Request, teamDomain?: string, policyAud?: string): Promise<string> {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) {
      throw new UnauthorizedError('No Cloudflare Access JWT token provided in request headers.');
    }

    if (!teamDomain || !policyAud) {
      throw new UnauthorizedError('Missing required JWT verification configuration.');
    }

    const audience = policyAud.trim();
    if (!audience) {
      throw new UnauthorizedError('Missing required JWT verification configuration.');
    }
    if (audience.includes(',')) {
      throw new UnauthorizedError('Multiple JWT audiences are not supported. Configure a single POLICY_AUD value.');
    }

    // The crypto (domain normalisation, JWKS fetch, claim checks) is the kit's:
    // `authenticateAccess` with no binding and no bypass can only take the JWT
    // path, and its failure already collapses to the single message below.
    try {
      return await authenticateAccess(request, undefined, { teamDomain, policyAud });
    } catch (error: unknown) {
      if (error instanceof AccessAuthError) throw new UnauthorizedError(error.message);
      throw error;
    }
  }
}

export { AccessAuthService };
export type { AccessAuthEnv, AccessIdentityContext };
