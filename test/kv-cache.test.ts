import { describe, expect, it, vi } from 'vitest';
import { KvCache } from '@duradav/backend-runtime/kv';
import type { KvNamespaceLike } from '@duradav/backend-runtime/kv';
import { buildKvKey, clampTtl, fnv1aHex, KV_DOMAINS, KV_MAX_KEY_LENGTH } from '@duradav/backend-runtime/kv';
import { Tokens, createRequestScope } from '@duradav/backend-services/composition';

// In-memory fake of the single CACHE binding (structural KvNamespaceLike).
function makeFakeKv(initial: Record<string, string> = {}): KvNamespaceLike & { store: Map<string, string>; seen: Array<{ key: string; ttl?: number }> } {
  const store = new Map(Object.entries(initial));
  const seen: Array<{ key: string; ttl?: number }> = [];
  return {
    store,
    seen,
    get(key: string): Promise<string | null> {
      return Promise.resolve(store.has(key) ? (store.get(key) as string) : null);
    },
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      seen.push({ key, ttl: options?.expirationTtl });
      store.set(key, value);
      return Promise.resolve();
    },
    delete(key: string): Promise<boolean> {
      return Promise.resolve(store.delete(key));
    },
    list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }> {
      const names = [...store.keys()].filter((name) => name.startsWith(options.prefix)).sort();
      const start = options.cursor ? Number(options.cursor) : 0;
      const limit = options.limit ?? 1000;
      const page = names.slice(start, start + limit);
      const next = start + limit;
      return Promise.resolve({
        keys: page.map((name) => ({ name })),
        list_complete: next >= names.length,
        cursor: next >= names.length ? undefined : String(next),
      });
    },
  };
}

describe('buildKvKey', () => {
  it('prefixes keys with domain and version', () => {
    expect(buildKvKey('refs', ['foo/bar', 'abc123'])).toBe('refs:v1:foo%2Fbar:abc123');
  });

  it('isolates domains sharing the same parts', () => {
    expect(buildKvKey('jwks', ['x'])).not.toBe(buildKvKey('oauth2', ['x']));
  });

  it('rejects unknown domains, empty parts, and empty segments', () => {
    expect(() => buildKvKey('nope' as never, ['x'])).toThrow(/Unknown KV domain/);
    expect(() => buildKvKey('refs', [])).toThrow(/at least one key part/);
    expect(() => buildKvKey('refs', ['   '])).toThrow(/must not be empty/);
  });

  it('hashes overlong keys deterministically within the length cap', () => {
    const long = `r/${'a'.repeat(600)}`;
    const first = buildKvKey('code', [long, 'path']);
    const second = buildKvKey('code', [long, 'path']);
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(KV_MAX_KEY_LENGTH);
    expect(first).toContain(':h:');
  });

  it('fnv1a is stable and 8 hex chars', () => {
    expect(fnv1aHex('duradav')).toBe(fnv1aHex('duradav'));
    expect(fnv1aHex('a')).not.toBe(fnv1aHex('b'));
    expect(fnv1aHex('x')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('clampTtl', () => {
  it('uses the domain default and honors overrides', () => {
    expect(clampTtl(undefined, 'jwks')).toBe(KV_DOMAINS.jwks.ttlSeconds);
    expect(clampTtl(120, 'jwks')).toBe(120);
  });

  it('leaves persistent domains without TTL', () => {
    expect(clampTtl(undefined, 'code')).toBeUndefined();
  });

  it('clamps below the platform minimum and drops non-finite values', () => {
    expect(clampTtl(1, 'ratelimit')).toBe(60);
    expect(clampTtl(Number.NaN, 'jwks')).toBeUndefined();
    expect(clampTtl(Number.POSITIVE_INFINITY, 'jwks')).toBeUndefined();
  });
});

describe('KvCache without a binding', () => {
  it('is unavailable and fail-soft', async () => {
    const cache = new KvCache(null);
    expect(cache.available).toBe(false);
    await expect(cache.getText('refs', ['a'])).resolves.toBeNull();
    await expect(cache.putText('refs', ['a'], 'v')).resolves.toBe(false);
    await expect(cache.getJson('refs', ['a'])).resolves.toBeNull();
    await expect(cache.putJson('refs', ['a'], { v: 1 })).resolves.toBe(false);
    await expect(cache.del('refs', ['a'])).resolves.toBeUndefined();
    await expect(cache.purgePrefix('refs')).resolves.toBe(0);
  });
});

describe('KvCache round-trips', () => {
  it('stores text with the domain TTL and reads it back', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    expect(cache.available).toBe(true);
    await expect(cache.putText('jwks', ['https://team.example.com'], '{"keys":[]}')).resolves.toBe(true);
    await expect(cache.getText('jwks', ['https://team.example.com'])).resolves.toBe('{"keys":[]}');
    expect(kv.seen).toHaveLength(1);
    expect(kv.seen[0].ttl).toBe(KV_DOMAINS.jwks.ttlSeconds);
  });

  it('persists code entries without expiration and honors per-call TTL', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await cache.putText('code', ['r1', 'oid', 'p'], 'body');
    expect(kv.seen[0].ttl).toBeUndefined();
    await cache.putText('refs', ['r1', 'oid'], 'snap', { ttlSeconds: 120 });
    expect(kv.seen[1].ttl).toBe(120);
  });

  it('rejects oversize values without touching the binding', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await expect(cache.putText('ratelimit', ['w'], 'x'.repeat(2048))).resolves.toBe(false);
    expect(kv.seen).toHaveLength(0);
  });

  it('round-trips JSON and returns null on corrupt payloads', async () => {
    const kv = makeFakeKv({ 'refs:v1:bad': 'not-json{' });
    const cache = new KvCache(kv);
    await expect(cache.putJson('searchCursor', ['r1'], { next: 8 })).resolves.toBe(true);
    await expect(cache.getJson<{ next: number }>('searchCursor', ['r1'])).resolves.toEqual({ next: 8 });
    await expect(cache.getJson('refs', ['bad'])).resolves.toBeNull();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(cache.putJson('refs', ['c'], circular)).resolves.toBe(false);
  });

  it('deletes single keys', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await cache.putText('oauth2', ['t1'], 'v');
    await cache.del('oauth2', ['t1']);
    await expect(cache.getText('oauth2', ['t1'])).resolves.toBeNull();
  });

  it('purges by domain prefix without touching sibling domains', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await cache.putText('refs', ['r1'], 'a');
    await cache.putText('refs', ['r2'], 'b');
    await cache.putText('jwks', ['r1'], 'c');
    await expect(cache.purgePrefix('refs')).resolves.toBe(2);
    await expect(cache.getText('jwks', ['r1'])).resolves.toBe('c');
  });

  it('purges a sub-prefix across list pages', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    const total = 1005;
    for (let i = 0; i < total; i += 1) {
      await cache.putText('refs', [`repo-${i}`], `v${i}`);
    }
    await expect(cache.purgePrefix('refs')).resolves.toBe(total);
    await expect(cache.getText('refs', ['repo-0'])).resolves.toBeNull();
    await expect(cache.getText('refs', [`repo-${total - 1}`])).resolves.toBeNull();
  });
});

describe('KvCache backend failures stay fail-soft', () => {
  it('returns null/false on throwing bindings', async () => {
    const failing: KvNamespaceLike = {
      get: () => Promise.reject(new Error('boom')),
      put: () => Promise.reject(new Error('boom')),
      delete: () => Promise.reject(new Error('boom')),
      list: () => Promise.reject(new Error('boom')),
    };
    const cache = new KvCache(failing);
    await expect(cache.getText('refs', ['a'])).resolves.toBeNull();
    await expect(cache.putText('refs', ['a'], 'v')).resolves.toBe(false);
    await expect(cache.del('refs', ['a'])).resolves.toBeUndefined();
    await expect(cache.purgePrefix('refs')).resolves.toBe(0);
  });
});

describe('request-scope KvCache binding', () => {
  it('binds an unavailable cache without CACHE and a live one with it', () => {
    const without = createRequestScope({ DB: {} } as never);
    expect(without.get(Tokens.KvCache).available).toBe(false);
    const kv = makeFakeKv();
    const withBinding = createRequestScope({ DB: {}, CACHE: kv } as never);
    expect(withBinding.get(Tokens.KvCache).available).toBe(true);
    expect(withBinding.get(Tokens.KvCache)).toBe(withBinding.get(Tokens.KvCache));
  });

  it('shares one instance per scope', () => {
    const scope = createRequestScope({ DB: {}, CACHE: makeFakeKv() } as never);
    const seen = vi.fn();
    seen(scope.get(Tokens.KvCache));
    expect(scope.get(Tokens.KvCache)).toBe(scope.get(Tokens.KvCache));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
