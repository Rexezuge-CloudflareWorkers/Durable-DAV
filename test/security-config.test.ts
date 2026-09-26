import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyCors, allowedOrigins } from '@durable-dav/webdav';
import { AppConfiguration } from '@durable-dav/backend-runtime/config';
import { contentTtls, DEFAULT_FILE_TTL_SECONDS, DEFAULT_PROP_TTL_SECONDS } from '@/workers/routes/DavReadCache';

const ok = (): Response => new Response('body', { status: 200 });

describe('CORS origin allow-list', () => {
  it('echoes an allow-listed origin', () => {
    const res = applyCors(ok(), new Request('https://dav.example.com/a', { headers: { Origin: 'https://dav.example.com' } }), 'https://dav.example.com');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://dav.example.com');
  });

  it('reflects no origin for a hostile one', () => {
    // The previous implementation echoed whatever asked, so any website could
    // read a WebDAV response — including a private volume's listing.
    const res = applyCors(ok(), new Request('https://dav.example.com/a', { headers: { Origin: 'https://evil.test' } }), 'https://dav.example.com');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('sets Vary: Origin whenever the response varies by origin', () => {
    const res = applyCors(ok(), new Request('https://dav.example.com/a', { headers: { Origin: 'https://dav.example.com' } }), 'https://dav.example.com');
    // Without this a shared cache may hand one origin's response to another.
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('omits the allow-origin header entirely when no Origin was sent', () => {
    const res = applyCors(ok(), new Request('https://dav.example.com/a'), 'https://dav.example.com');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('falls back to same-origin only when SITE_URL is unset or malformed', () => {
    for (const siteUrl of [undefined, null, '', 'not a url']) {
      const res = applyCors(ok(), new Request('https://dav.example.com/a', { headers: { Origin: 'https://dav.example.com' } }), siteUrl);
      expect(res.headers.get('Access-Control-Allow-Origin'), String(siteUrl)).toBeNull();
    }
  });

  it('normalises SITE_URL to a bare origin so a path cannot widen the list', () => {
    expect(allowedOrigins('https://dav.example.com/some/path?q=1')).toEqual(['https://dav.example.com']);
  });

  it('never advertises credentialed CORS', () => {
    // No cookies or HTTP-auth are used on the WebDAV plane, so credentialed CORS
    // is never appropriate; advertising it would let a hostile origin piggyback
    // on whatever the browser attached.
    const res = applyCors(ok(), new Request('https://dav.example.com/a', { headers: { Origin: 'https://dav.example.com' } }), 'https://dav.example.com');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('false');
  });

  it('preserves the original status and body', () => {
    const res = applyCors(new Response('nope', { status: 405 }), new Request('https://dav.example.com/a'), 'https://dav.example.com');
    expect(res.status).toBe(405);
  });
});

describe('production template carries no auth bypass', () => {
  const template = readFileSync(
    fileURLToPath(new URL('../apps/api/wrangler.template.jsonc', import.meta.url)),
    'utf8',
  );

  it('does not ship DEV_AUTH_EMAIL', () => {
    // Either variable authenticates *every* unauthenticated request as that
    // identity. Shipping one inside the production template turns a one-word
    // edit (`ENVIRONMENT: "staging"`, or an `env.*` block that inherits `vars`)
    // into a full account takeover with no attacker effort.
    expect(template).not.toMatch(/"DEV_AUTH_EMAIL"/);
  });

  it('does not ship DEMO_MODE', () => {
    expect(template).not.toMatch(/"DEMO_MODE"/);
  });
});

describe('AppConfiguration.validate', () => {
  const env = (overrides: Record<string, string> = {}): Env =>
    ({ ENVIRONMENT: 'production', ...overrides }) as unknown as Env;

  it('is clean for a well-formed production config', () => {
    expect(AppConfiguration.fromEnv(env({ MAX_FILE_BYTES: '52428800' })).validate()).toEqual([]);
  });

  it('reports a malformed numeric var instead of silently defaulting', () => {
    const warnings = AppConfiguration.fromEnv(env({ MAX_FILE_BYTES: 'banana' })).validate();
    expect(warnings.join('\n')).toContain('MAX_FILE_BYTES');
  });

  it('warns when a production deploy has an auth bypass set', () => {
    const warnings = AppConfiguration.fromEnv(env({ DEV_AUTH_EMAIL: 'someone@example.com' })).validate();
    expect(warnings.join('\n')).toMatch(/DEV_AUTH_EMAIL.*production/s);
  });

  it('warns for DEMO_MODE in production too', () => {
    const warnings = AppConfiguration.fromEnv(env({ DEMO_MODE: 'true' })).validate();
    expect(warnings.join('\n')).toContain('DEMO_MODE');
  });

  it('stays quiet about the bypass outside production', () => {
    expect(AppConfiguration.fromEnv(env({ ENVIRONMENT: 'staging', DEV_AUTH_EMAIL: 'dev@example.com' })).validate()).toEqual([]);
  });
});

describe('DAV_CACHE_TTL_SECONDS is wired', () => {
  it('uses the configured value for the file cache', () => {
    // The variable was present in the wrangler template with a config getter
    // implemented, and nothing ever called it, so tuning it did nothing.
    const ttls = contentTtls(AppConfiguration.fromEnv({ DAV_CACHE_TTL_SECONDS: '42' } as unknown as Env).getDavCacheTtlSeconds());
    expect(ttls.file).toBe(42);
  });

  it('scales the propfind cache with it, capped below the file TTL', () => {
    const ttls = contentTtls(AppConfiguration.fromEnv({ DAV_CACHE_TTL_SECONDS: '300' } as unknown as Env).getDavCacheTtlSeconds());
    expect(ttls.prop).toBeLessThan(ttls.file);
  });

  it('falls back to the built-in defaults for an absent or non-positive value', () => {
    for (const value of [null, undefined, 0, -1]) {
      expect(contentTtls(value)).toEqual({ prop: DEFAULT_PROP_TTL_SECONDS, file: DEFAULT_FILE_TTL_SECONDS });
    }
  });

  it('never yields a non-positive TTL for a tiny configured value', () => {
    expect(contentTtls(1).prop).toBeGreaterThanOrEqual(1);
  });
});
