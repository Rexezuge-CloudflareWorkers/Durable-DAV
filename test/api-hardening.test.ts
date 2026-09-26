import { describe, expect, it, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  RATE_LIMIT_DEFS,
  getRateLimitBucketCountForTests,
  registerRateLimits,
  resetRateLimitForTests,
  clientIp,
  rateLimit,
} from '../apps/api/src/middleware';
import { invalidatesReadCache } from '../apps/api/src/workers/routes/DavReadCache';
import { acceptsHtml as acceptsHtmlForTest } from '../apps/api/src/workers/acceptsHtml';
import { MAX_XML_BODY_BYTES, readCappedBody, readCappedText, exceedsDeclaredLength } from '@durable-dav/webdav';

const env = {} as Env;

/** A concrete request path that each registry pattern is meant to cover. */
function sampleUrlFor(pattern: string): string {
  if (pattern === '/user/volumes/*') return 'https://x/user/volumes';
  if (pattern === '/user/me/username') return 'https://x/user/me/username';
  if (pattern === '/user/me') return 'https://x/user/me';
  if (pattern === '/users/*') return 'https://x/users/alice';
  if (pattern === '/:owner/:volume/*') return 'https://x/alice/photos/dir/f.txt';
  throw new Error(`sampleUrlFor has no case for ${pattern}`);
}

type TestApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function buildApp(): TestApp {
  const app = new Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>();
  app.use('*', async (c, next) => {
    c.set('AuthenticatedUserEmailAddress', 'alice@example.com');
    await next();
  });
  registerRateLimits(app);
  app.all('/user/volumes', (c) => c.json({ ok: true }));
  app.all('/user/me', (c) => c.json({ ok: true }));
  app.all('/user/me/username', (c) => c.json({ ok: true }));
  app.all('/users/:username', (c) => c.json({ ok: true }));
  app.all('/:owner/:volume', (c) => c.json({ ok: true }));
  app.all('/:owner/:volume/*', (c) => c.json({ ok: true }));
  return app;
}

describe('rate limiting is actually wired', () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  it('returns 429 once a bucket is exhausted', async () => {
    const app = buildApp();
    const def = RATE_LIMIT_DEFS.find((d) => d.keyPrefix === 'username-rename');
    expect(def).toBeDefined();
    const limit = def?.max ?? 0;
    for (let i = 0; i < limit; i += 1) {
      const res = await app.request('https://x/user/me/username', { method: 'PATCH' }, env);
      expect(res.status).toBe(200);
    }
    const blocked = await app.request('https://x/user/me/username', { method: 'PATCH' }, env);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toMatch(/^\d+$/);
    const body = (await blocked.json()) as { Exception: { Type: string } };
    expect(body.Exception.Type).toBe('RateLimited');
  });

  it('does not double-charge /user/volumes to the webdav bucket', async () => {
    // `/:owner/:volume*` is two labels and therefore also matches
    // `/user/volumes`; without the `exclude` guard one request was counted
    // in both buckets.
    const app = buildApp();
    const def = RATE_LIMIT_DEFS.find((d) => d.keyPrefix === 'volumes');
    for (let i = 0; i < (def?.max ?? 0); i += 1) {
      expect((await app.request('https://x/user/volumes', { method: 'POST' }, env)).status).toBe(200);
    }
    expect((await app.request('https://x/user/volumes', { method: 'POST' }, env)).status).toBe(429);
    // The webdav bucket must still be untouched.
    expect(getRateLimitBucketCountForTests()).toBe(1);
  });

  it('still rate-limits genuine volume paths', async () => {
    const app = buildApp();
    const def = RATE_LIMIT_DEFS.find((d) => d.keyPrefix === 'webdav');
    for (let i = 0; i < (def?.max ?? 0); i += 1) {
      expect((await app.request('https://x/alice/photos/f.txt', { method: 'GET' }, env)).status).toBe(200);
    }
    expect((await app.request('https://x/alice/photos/f.txt', { method: 'GET' }, env)).status).toBe(429);
  });

  it('charges exactly one increment per request', async () => {
    // Hono's trailing `/*` also matches the bare path, so registering a root
    // pattern alongside its sub-tree ran the same middleware twice and halved
    // every effective limit (60 became 30). Assert the real limit is the
    // effective limit by exhausting it in exactly `max` requests.
    for (const def of RATE_LIMIT_DEFS) {
      const app = buildApp();
      const url = sampleUrlFor(def.path);
      let blockedAt = -1;
      for (let i = 0; i < def.max + 2; i += 1) {
        const res = await app.request(url, { method: 'GET' }, env);
        if (res.status === 429) {
          blockedAt = i;
          break;
        }
      }
      expect(blockedAt, `${def.keyPrefix} should block on request ${String(def.max + 1)}`).toBe(def.max);
      resetRateLimitForTests();
    }
  });

  it('calls next() exactly once when the downstream handler throws', async () => {
    // The old `try { ... await next() } catch { await next() }` shape could
    // invoke `next()` twice, which Hono rejects with
    // "next() called multiple times".
    let calls = 0;
    const app = new Hono();
    app.use('*', rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'boom' }));
    app.get('/x', () => {
      calls += 1;
      throw new Error('downstream failure');
    });
    app.onError(() => new Response('handled', { status: 500 }));
    const res = await app.request('https://x/x', {}, env);
    expect(calls).toBe(1);
    expect(res.status).toBe(500);
  });

  it('negotiates HTML by quality value, not substring', () => {
    // A substring test for `text/html` served the SPA shell to DAV clients
    // that merely list it among many accepted types, and ignored `q=0`.
    const withAccept = (accept?: string): boolean => {
      const headers = accept === undefined ? {} : { Accept: accept };
      return acceptsHtmlForTest(new Request('https://x/alice/photos', { headers }));
    };
    expect(withAccept('text/html')).toBe(true);
    expect(withAccept('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(true);
    // Explicit refusal.
    expect(withAccept('text/html;q=0, */*;q=0.5')).toBe(false);
    // XML wins on quality, so the DAV representation is correct.
    expect(withAccept('text/html;q=0.1, application/xml;q=0.9')).toBe(false);
    // A bare `*/*` states no preference, so the WebDAV representation wins —
    // that is what curl and DAV clients send.
    expect(withAccept('*/*')).toBe(false);
    expect(withAccept('*/*;q=0.1, application/xml')).toBe(false);
    // `text/*` is a type wildcard over html, so it is an explicit request.
    expect(withAccept('text/*')).toBe(true);
    // No Accept header at all.
    expect(withAccept()).toBe(false);
    expect(withAccept('application/xml')).toBe(false);
  });

  it('rejects invalid registration options at construction time', () => {
    expect(() => rateLimit({ windowMs: 0, max: 1, keyPrefix: 'a' })).toThrow(/windowMs/);
    expect(() => rateLimit({ windowMs: 1, max: 0, keyPrefix: 'a' })).toThrow(/max/);
    expect(() => rateLimit({ windowMs: 1, max: 1, keyPrefix: '  ' })).toThrow(/keyPrefix/);
  });

  it('groups anonymous callers without a trusted CF-Connecting-IP', () => {
    const ctx = { req: { header: () => undefined } } as never;
    expect(clientIp(ctx)).toBe('unknown');
  });
});

describe('read cache invalidation is scoped to content changes', () => {
  it('invalidates for writes only', () => {
    for (const m of ['PUT', 'DELETE', 'MKCOL', 'COPY', 'MOVE', 'PROPPATCH']) {
      expect(invalidatesReadCache(m)).toBe(true);
    }
  });

  it('does not invalidate for OPTIONS, LOCK or UNLOCK', () => {
    // The old predicate was the complement of the read set, so every
    // OPTIONS/LOCK/UNLOCK a client sent triggered two full purge sweeps.
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'PROPFIND', 'LOCK', 'UNLOCK']) {
      expect(invalidatesReadCache(m)).toBe(false);
    }
  });
});

describe('capped body reads', () => {
  it('rejects an oversize declared Content-Length without reading the stream', async () => {
    const request = new Request('https://x/', { method: 'PUT', body: 'hello', headers: { 'Content-Length': '99' } });
    expect(exceedsDeclaredLength(request, 10)).toBe(true);
    expect(await readCappedBody(request, 10)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('ignores a non-numeric Content-Length and enforces the cap while streaming', async () => {
    // A chunked request omits Content-Length, so the streaming read is the
    // only thing that actually bounds memory.
    const request = new Request('https://x/', { method: 'PUT', body: 'x'.repeat(5000), headers: { 'Content-Length': 'abc' } });
    expect(exceedsDeclaredLength(request, 1024)).toBe(false);
    expect(await readCappedBody(request, 1024)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('returns the exact bytes when under the cap', async () => {
    const request = new Request('https://x/', { method: 'PUT', body: 'hello world' });
    const result = await readCappedBody(request, 1024);
    expect(result.ok).toBe(true);
    if (result.ok) expect(new TextDecoder().decode(result.bytes)).toBe('hello world');
  });

  it('handles an absent body', async () => {
    const result = await readCappedText(new Request('https://x/', { method: 'DELETE' }), 1024);
    expect(result).toEqual({ ok: true, text: '' });
  });

  it('treats the XML cap as a small, sane default', () => {
    expect(MAX_XML_BODY_BYTES).toBe(64 * 1024);
  });
});
