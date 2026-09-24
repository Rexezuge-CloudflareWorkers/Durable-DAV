import type { Context, Next } from 'hono';

type HeaderContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Origin-Agent-Cluster': '?1',
};

// Paths carrying bearer secrets or private user data — never cache.
// Exact-prefix match (not substring) so future `/hooks`-like paths cannot
// accidentally inherit `no-store`, and secret routes cannot be missed.
// BREAKING: all `/user/*` JSON is `no-store` by default (collaborators,
// orgs, notifications, stars/watches, search reflecting private titles).
// Public `/repos/*` stays cacheable except issues/pulls/audit reflections.
function isSensitiveJsonPath(pathname: string): boolean {
  if (['/user/tokens', '/user/realtime/ticket', '/user/realtime/inbox-ticket'].includes(pathname)) {
    return true;
  }
  if (pathname.startsWith('/user/')) return true;
  return pathname.includes('/issues') || pathname.includes('/pulls') || pathname.includes('/audit');
}

/**
 * Baseline security headers for API JSON responses and the SPA shell.
 * The SPA ships inline scripts/styles from the Vite build, so CSP allows
 * 'unsafe-inline' for scripts + styles (bounded by same-origin + no
 * frame-ancestors). Without it the shell breaks; hashes/nonces are a
 * future tightening once the build emits stable hashes.
 */
function applySecurityHeaders(c: HeaderContext): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(key, value);
  }
  const contentType = c.res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
    );
  }
  // Bearer-secret JSON (PATs, hook secrets, realtime tickets) must never be
  // cached by browsers or CDNs.
  try {
    const pathname = new URL(c.req.url).pathname;
    if (isSensitiveJsonPath(pathname)) {
      c.header('Cache-Control', 'no-store');
    }
  } catch {
    // URL parsing must never fail the request.
  }
  // HSTS only over HTTPS — sending it over plain HTTP risks local pinning
  // and is ignored by browsers anyway.
  try {
    if (new URL(c.req.url).protocol === 'https:') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  } catch {
    // URL parsing must never fail the request.
  }
}

function securityHeaders(): (c: HeaderContext, next: Next) => Promise<Response | void> {
  // eslint-disable-next-line unicorn/consistent-function-scoping
  return async (c: HeaderContext, next: Next): Promise<Response | void> => {
    await next();
    try {
      applySecurityHeaders(c);
    } catch {
      // Headers must never fail the request.
    }
  };
}

export { securityHeaders, SECURITY_HEADERS, isSensitiveJsonPath, applySecurityHeaders };
