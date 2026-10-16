import { describe, expect, it, vi } from 'vitest';
import { AccessAuthService } from '../packages/backend-services/src/auth/AccessAuthService';
import { UserIdentityService } from '@rexezuge/identity';
import type { UserRow } from '@rexezuge/identity';

/**
 * The two paths the migration left uncovered.
 *
 * `verifyAccessJwt` is the one place a JWT reaches Cloudflare, and its
 * configuration guards run before any network call — a blank or comma-joined
 * audience is a deploy-time mistake that must fail as itself rather than as a
 * generic fetch failure. The team domain is normalised once (lowercased,
 * trailing slashes stripped) before it becomes a JWKS URL, so the assertion
 * below pins the *requested* URL rather than trusting the normaliser.
 *
 * `jose` is real here and only the JWKS fetch is stubbed: mocking the module
 * by specifier does not reach the copy `backend-services` resolves, so a
 * stubbed verifier would certify nothing.
 */

function requestWith(token?: string): Request {
  const headers = new Headers();
  if (token) headers.set('cf-access-jwt-assertion', token);
  return new Request('https://dav.example.com/', { headers });
}

describe('AccessAuthService.verifyAccessJwt — configuration guards', () => {
  it('refuses a request carrying no token', async () => {
    await expect(AccessAuthService.verifyAccessJwt(requestWith())).rejects.toThrow(/no cloudflare access jwt/i);
  });

  it('refuses an unconfigured verifier', async () => {
    // Named as a configuration fault, not a token fault: nothing has reached
    // the network, so nothing about the request can be inferred from it.
    await expect(AccessAuthService.verifyAccessJwt(requestWith('token'), '', 'aud')).rejects.toThrow(/configuration/i);
    await expect(AccessAuthService.verifyAccessJwt(requestWith('token'), 'https://team.example.com', '')).rejects.toThrow(/configuration/i);
  });

  it('refuses a blank audience and a multi-audience list', async () => {
    // A blank aud is a whitespace-only secret; a comma-joined one would only
    // ever match the first entry, so a valid token for the second audience
    // would be refused as an authentication failure.
    await expect(AccessAuthService.verifyAccessJwt(requestWith('token'), 'https://team.example.com', ' '.repeat(3))).rejects.toThrow(
      /configuration/i,
    );
    await expect(AccessAuthService.verifyAccessJwt(requestWith('token'), 'https://team.example.com', 'a,b')).rejects.toThrow(/multiple/i);
  });

  it('normalises the team domain into the JWKS URL it requests', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      // jose hands the remote JWK set a `URL`; accept all three shapes a
      // caller of `fetch` may see rather than stringifying whatever arrives.
      fetched.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      // A 404 stands in for an unreachable JWKS: the verifier fails and the
      // token is refused, which is the assertion that matters. The URL is the
      // point of the test.
      return new Response('not found', { status: 404 });
    });

    // A *well-formed* token: jose parses the JWT before it reaches for a key,
    // so a garbage string never fetches and would pass a URL-less test.
    // A padded-base64url segment. `=` only ever pads the tail, so the strip is
    // an anchored trim rather than a pattern over the whole string.
    const b64url = (value: unknown) => {
      const encoded: string = btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_');
      return encoded.endsWith('=') ? encoded.slice(0, encoded.indexOf('=')) : encoded;
    };
    const token = [
      b64url({ alg: 'RS256', typ: 'JWT' }),
      b64url({ iss: 'https://team.example.com', aud: 'aud', email: 'a@b.co', email_verified: true }),
      'not-a-real-signature',
    ].join('.');

    await expect(AccessAuthService.verifyAccessJwt(requestWith(token), 'https://Team.Example.com///', 'aud')).rejects.toThrow(
      /authentication failed/i,
    );

    expect(fetched[0]).toBe('https://team.example.com/cdn-cgi/access/certs');
    vi.unstubAllGlobals();
  });
});

describe('AccessAuthService — the platform-identity fallback', () => {
  it('fails closed on an unverified platform identity', async () => {
    // Access bindings are trusted, but an unverified identity must never
    // authenticate — the same rule the JWT path applies to `email_verified`.
    const service = new AccessAuthService({});

    await expect(
      service.getAuthenticatedUserEmail(new Request('https://dav.example.com/'), {
        access: { getIdentity: async () => ({ email: 'someone@example.com', emailVerified: false }) },
      } as never),
    ).rejects.toThrow(/authentication failed/i);
  });

  it('never trusts the spoofed Cf-Access-Authenticated-User-Email header', async () => {
    const service = new AccessAuthService({});
    const spoofed = new Request('https://dav.example.com/', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com' },
    });

    await expect(service.getAuthenticatedUserEmail(spoofed)).rejects.toThrow(/authentication failed/i);
  });
});

describe('UserIdentityService — error normalisation and address claims', () => {
  const identityEnv = { DB: {} as never };

  function identityService(overrides: Record<string, unknown> = {}) {
    return new UserIdentityService(identityEnv, overrides as never);
  }

  it('constructs its default DAOs without touching the environment', async () => {
    // The default factories are `new UserDAO(env.DB)`; constructing the service
    // must not open a connection, and the memo starts empty.
    const service = identityService();
    await expect(service.resolveAccount('someone@example.com')).rejects.toThrow();
  });

  it('lets a raw lookup failure propagate instead of reading as "no such account"', async () => {
    // A failed read is an outage and must not read as "no such account": the
    // kit's service does not wrap DAO errors, so the caller sees the failure
    // itself rather than a typed message naming the read.
    const service = identityService({
      userDAO: () =>
        Promise.resolve({
          getById: async () => {
            throw new Error('D1_ERROR: database is locked');
          },
        } as never),
    });

    await expect(service.resolveAccountById('usr_1')).rejects.toThrow(/database is locked/s);
  });

  it('lets a failed address resolution propagate the same way', async () => {
    const service = identityService({
      userEmailDAO: () =>
        Promise.resolve({
          get: async () => {
            // Not a missing-schema error: the fail-closed rule tolerates only
            // a pre-0004 database, and a transient failure must propagate.
            throw new Error('D1_ERROR: database is locked');
          },
        } as never),
    });

    await expect(service.resolveAccount('someone@example.com')).rejects.toThrow(/database is locked/s);
  });

  it('refuses to link an address another account already holds verified', async () => {
    // A verified row belongs to someone: re-pointing it would strand that
    // account's sign-in address, so the claim is refused rather than moved.
    const service = identityService({
      userEmailDAO: () => Promise.resolve({ register: async () => 'already-claimed' } as never),
    });

    await expect(service.linkVerifiedEmail('usr_1', 'taken@example.com')).rejects.toThrow(/already in use/i);
  });

  it('links a free address, lowercased', async () => {
    const registered: Array<{ email: string; userId: string }> = [];
    const service = identityService({
      userEmailDAO: () =>
        Promise.resolve({
          register: async (input: { email: string; userId: string; isVerified: boolean }) => {
            registered.push({ email: input.email, userId: input.userId });
            return 'claimed' as const;
          },
        } as never),
    });

    await expect(service.linkVerifiedEmail('usr_1', 'New@Example.com')).resolves.toBeUndefined();
    expect(registered).toEqual([{ email: 'new@example.com', userId: 'usr_1' }]);
  });
});

describe('UserIdentityService.resolveAccountId', () => {
  it('answers null for an unknown address', async () => {
    // Absence is `null`: the kit's DAO answers "no row" the way `D1Result`
    // and `KVNamespace` do, and the service preserves that spelling.
    const service = new UserIdentityService({ DB: {} as never }, {
      userEmailDAO: () => Promise.resolve({ get: async () => null } as never),
      userDAO: () =>
        Promise.resolve({
          getByCurrentEmail: async (): Promise<UserRow | null> => null,
          getByEmail: async (): Promise<UserRow | null> => null,
        } as never),
    } as never);

    await expect(service.resolveAccountId('nobody@example.com')).resolves.toBeNull();
  });
});
