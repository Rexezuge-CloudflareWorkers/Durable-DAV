import { afterEach, describe, expect, it, vi } from 'vitest';
import { KvCache, resetBreakerForTests } from '@rexezuge/runtime';
import type { KvNamespaceLike } from '@rexezuge/runtime';
import { buildKvKey, clampTtl, digest128, KV_DOMAINS } from '@rexezuge/runtime';
import { Tokens, createRequestScope } from '@durable-dav/backend-services/composition';
import { base64ToBytes, bytesToBase64 } from '@rexezuge/shared';
import {
  MAX_CACHED_FILE_BYTES,
  cacheControlFor,
  cacheKeyForVolume,
  etagForPropfind,
  getCachedFile,
  getCachedPropfind,
  getCachedVolumeList,
  hashBody,
  invalidateVolumeCaches,
  invalidateVolumeListCache,
  isFresh,
  putCachedFile,
  putCachedPropfind,
  putCachedVolumeList,
} from '../apps/api/src/workers/routes/DavReadCache';

// `KvCache`'s circuit breaker is per-isolate state, not per-instance: three
// consecutive failures open it for every later test in this file (the
// deliberately-failing bindings below trip it), and an open breaker answers
// from its fallback, which reads as a cache miss. Reset it between tests, the
// same way the kit's own suite does.
afterEach(() => {
  resetBreakerForTests();
});

// In-memory fake of the single CACHE binding (structural KvNamespaceLike).
// Ported from ../Git `test/kv-cache.test.ts`. Stores text and binary entries
// separately so `getBinary`/`getWithMetadata` behave like the real binding:
// binary values carry KV metadata, text values do not.
function makeFakeKv(initial: Record<string, string> = {}): KvNamespaceLike & {
  store: Map<string, { text?: string; bytes?: Uint8Array; metadata?: unknown }>;
  seen: Array<{ key: string; ttl?: number }>;
} {
  const store = new Map<string, { text?: string; bytes?: Uint8Array; metadata?: unknown }>(
    Object.entries(initial).map(([key, text]) => [key, { text }]),
  );
  const seen: Array<{ key: string; ttl?: number }> = [];
  const ns = {
    store,
    seen,
    get(key: string, type?: string): Promise<string | ArrayBuffer | null> {
      const entry = store.get(key);
      if (!entry) return Promise.resolve(null);
      if (type === 'arrayBuffer') {
        if (entry.bytes) return Promise.resolve(entry.bytes.slice().buffer as ArrayBuffer);
        return entry.text === undefined
          ? Promise.resolve(null)
          : Promise.resolve(new TextEncoder().encode(entry.text).buffer as ArrayBuffer);
      }
      return entry.text === undefined ? Promise.resolve(null) : Promise.resolve(entry.text);
    },
    getWithMetadata(key: string, type?: string): Promise<{ value: string | ArrayBuffer | null; metadata: unknown }> {
      const entry = store.get(key);
      if (!entry) return Promise.resolve({ value: null, metadata: undefined });
      if (type === 'arrayBuffer' || type === undefined) {
        if (entry.bytes) return Promise.resolve({ value: entry.bytes.slice().buffer as ArrayBuffer, metadata: entry.metadata });
        if (entry.text !== undefined)
          return Promise.resolve({ value: new TextEncoder().encode(entry.text).buffer as ArrayBuffer, metadata: entry.metadata });
      }
      return Promise.resolve({ value: null, metadata: entry.metadata });
    },
    put(key: string, value: string | ArrayBuffer | Uint8Array, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void> {
      seen.push({ key, ttl: options?.expirationTtl });
      if (typeof value === 'string') {
        store.set(key, { text: value, metadata: options?.metadata });
      } else if (value instanceof ArrayBuffer) {
        store.set(key, { bytes: new Uint8Array(value.slice(0)), metadata: options?.metadata });
      } else if (value instanceof Uint8Array) {
        store.set(key, { bytes: value.slice(), metadata: options?.metadata });
      } else {
        store.set(key, { text: String(value), metadata: options?.metadata });
      }
      return Promise.resolve();
    },
    delete(key: string): Promise<boolean> {
      return Promise.resolve(store.delete(key));
    },
    list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{
      keys: Array<{ name: string }>;
      list_complete: boolean;
      cursor?: string;
    }> {
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
  return ns as unknown as KvNamespaceLike & {
    store: Map<string, { text?: string; bytes?: Uint8Array; metadata?: unknown }>;
    seen: Array<{ key: string; ttl?: number }>;
  };
}

describe('dav KV domains', () => {
  // The kit's closed domain registry: this repo's davProp/davFile/davMeta
  // vocabulary renamed onto the family's three domains (`davProp`->metadata,
  // `davFile`->asset, `davMeta`->metadata). KV is a loss-tolerant cache, so a
  // renamed prefix recomputes rather than migrates.
  it('registers the family domains the read caches key on', () => {
    expect(KV_DOMAINS.metadata.ttlSeconds).toBe(120);
    expect(KV_DOMAINS.asset.ttlSeconds).toBe(300);
    expect(KV_DOMAINS.asset.maxValueBytes).toBe(10_485_760);
    expect(buildKvKey('metadata', ['alice/demo', 'x'])).toBe('metadata:v1:alice%2Fdemo:x');
  });

  it('isolates DAV domains sharing the same parts', () => {
    expect(buildKvKey('metadata', ['x'])).not.toBe(buildKvKey('asset', ['x']));
    expect(buildKvKey('session', ['x'])).not.toBe(buildKvKey('metadata', ['x']));
  });

  it('rejects unknown domains, empty parts, and empty segments', () => {
    expect(() => buildKvKey('nope' as never, ['x'])).toThrow(/Unknown KV domain/);
    expect(() => buildKvKey('metadata', [])).toThrow(/at least one key part/);
    expect(() => buildKvKey('asset', [' '.repeat(3)])).toThrow(/must not be empty/);
  });

  it('hashes overlong DAV keys deterministically within the length cap', () => {
    const long = `v/${'a'.repeat(600)}`;
    const first = buildKvKey('metadata', [long, 'path']);
    const second = buildKvKey('metadata', [long, 'path']);
    expect(first).toBe(second);
    // 512 is KV's platform key cap, which the kit's KvDomains enforces by
    // digesting an overlong key. Asserted here rather than imported: the kit's
    // package root does not re-export the constant yet.
    expect(first.length).toBeLessThanOrEqual(512);
    expect(first).toContain(':h:');
  });

  it('digest128 is stable and 32 hex chars', () => {
    // 128 bits, not 32: `davFile` keys embed a user-controlled path, so a
    // short digest in a shared keyspace is collision-searchable.
    expect(digest128('durable-dav')).toBe(digest128('durable-dav'));
    expect(digest128('a')).not.toBe(digest128('b'));
    expect(digest128('x')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('overflow keys are 32 hex chars and still domain-prefixed', () => {
    const long = 'a'.repeat(600);
    const key = buildKvKey('asset', ['alice/demo', `path:${long}`]);
    expect(key).toMatch(/^asset:v1:h:[0-9a-f]{32}$/);
  });
});

describe('clampTtl for DAV domains', () => {
  it('uses domain defaults and honors overrides', () => {
    expect(clampTtl(undefined, 'metadata')).toBe(120);
    expect(clampTtl(undefined, 'asset')).toBe(300);
    // This repo's former `davMeta` volume-listing cache is a derived snapshot, so it
    // lands on the kit's `metadata` domain (120s) rather than `session`; its own
    // 60s TTL is passed explicitly on every write.
    expect(clampTtl(undefined, 'metadata')).toBe(120);
    expect(clampTtl(180, 'metadata')).toBe(180);
  });

  it('clamps below the platform minimum and falls back to the domain default', () => {
    expect(clampTtl(1, 'session')).toBe(60);
    // Every domain declares a required ttl, so a non-finite override falls back
    // to that default rather than disabling expiry.
    expect(clampTtl(NaN, 'metadata')).toBe(120);
    expect(clampTtl(Infinity, 'asset')).toBe(300);
  });
});

describe('KvCache without a binding', () => {
  it('is unavailable and fail-soft', async () => {
    const cache = new KvCache(null);
    expect(cache.available).toBe(false);
    await expect(cache.getText('metadata', ['a'])).resolves.toBeNull();
    await expect(cache.putText('metadata', ['a'], 'v')).resolves.toBe(false);
    await expect(cache.getJson('metadata', ['a'])).resolves.toBeNull();
    await expect(cache.putJson('metadata', ['a'], { v: 1 })).resolves.toBe(false);
    await expect(cache.getBinary('asset', ['a'])).resolves.toBeNull();
    await expect(cache.putBinary('asset', ['a'], new Uint8Array([1]), { etag: '"e"', contentType: null })).resolves.toBe(false);
    await expect(cache.del('metadata', ['a'])).resolves.toBeUndefined();
    await expect(cache.purgePrefix('metadata')).resolves.toBe(0);
  });
});

describe('KvCache DAV round-trips', () => {
  it('stores propfind text with the domain TTL and reads it back', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await expect(cache.putText('metadata', ['alice/demo', 'p'], '<multistatus/>')).resolves.toBe(true);
    await expect(cache.getText('metadata', ['alice/demo', 'p'])).resolves.toBe('<multistatus/>');
    expect(kv.seen).toHaveLength(1);
    expect(kv.seen[0].ttl).toBe(KV_DOMAINS.metadata.ttlSeconds);
  });

  it('rejects oversize values without touching the binding', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await expect(cache.putText('session', ['w'], 'x'.repeat(100_000))).resolves.toBe(false);
    expect(kv.seen).toHaveLength(0);
  });

  it('purges a DAV sub-prefix without touching sibling domains', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await cache.putText('metadata', ['alice/demo', 'a'], 'a');
    await cache.putText('metadata', ['alice/demo', 'b'], 'b');
    await cache.putBinary('asset', ['alice/demo', 'a'], new Uint8Array([99]), { etag: '"c"', contentType: null });
    await expect(cache.purgePrefix('metadata', ['alice/demo'])).resolves.toBe(2);
    await expect(cache.getBinary('asset', ['alice/demo', 'a'])).resolves.toEqual({
      bytes: new Uint8Array([99]),
      metadata: { etag: '"c"', contentType: null },
    });
  });

  it('stores file binaries with metadata and rejects oversize or etag-less writes', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await expect(
      cache.putBinary('asset', ['alice/demo', 'a'], new Uint8Array([1, 2, 3]), { etag: '"e"', contentType: 'text/plain' }),
    ).resolves.toBe(true);
    await expect(cache.getBinary('asset', ['alice/demo', 'a'])).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { etag: '"e"', contentType: 'text/plain' },
    });
    expect(kv.seen[0].ttl).toBe(KV_DOMAINS.asset.ttlSeconds);
    await expect(
      cache.putBinary('asset', ['w'], new Uint8Array(KV_DOMAINS.asset.maxValueBytes + 1), { etag: '"big"', contentType: null }),
    ).resolves.toBe(false);
    await expect(cache.putBinary('asset', ['w'], new Uint8Array([1]), { etag: '', contentType: null })).resolves.toBe(false);
  });

  it('reads text-only entries as a binary miss (legacy rows migrate via getJson)', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await cache.putText('asset', ['alice/demo', 'legacy'], '{"b64":"aGk="}');
    await expect(cache.getBinary('asset', ['alice/demo', 'legacy'])).resolves.toBeNull();
  });
});

describe('KvCache backend failures stay fail-soft', () => {
  it('returns null/false on throwing bindings', async () => {
    const boom = (): Promise<never> => Promise.reject(new Error('boom'));
    const failing: KvNamespaceLike = {
      get: boom as KvNamespaceLike['get'],
      put: boom,
      delete: boom,
      list: boom,
    };
    const cache = new KvCache(failing);
    await expect(cache.getText('metadata', ['a'])).resolves.toBeNull();
    await expect(cache.putText('metadata', ['a'], 'v')).resolves.toBe(false);
    await expect(cache.getBinary('asset', ['a'])).resolves.toBeNull();
    await expect(cache.putBinary('asset', ['a'], new Uint8Array([1]), { etag: '"e"', contentType: null })).resolves.toBe(false);
    await expect(cache.del('metadata', ['a'])).resolves.toBeUndefined();
    await expect(cache.purgePrefix('metadata')).resolves.toBe(0);
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

describe('DavReadCache helpers', () => {
  it('canonicalizes volume keys to lowercase', () => {
    expect(cacheKeyForVolume('Alice', 'Demo')).toBe('alice/demo');
    expect(cacheKeyForVolume('ALICE', 'DEMO')).toBe(cacheKeyForVolume('alice', 'demo'));
  });

  it('detects fresh conditional requests', () => {
    const etag = 'W/"prop-abc"';
    expect(isFresh(new Request('https://x/', { headers: { 'If-None-Match': etag } }), etag)).toBe(true);
    expect(isFresh(new Request('https://x/', { headers: { 'If-None-Match': '*' } }), etag)).toBe(true);
    expect(isFresh(new Request('https://x/', { headers: { 'If-None-Match': 'W/"other"' } }), etag)).toBe(false);
    expect(isFresh(new Request('https://x/'), etag)).toBe(false);
    expect(isFresh(new Request('https://x/', { headers: { 'If-None-Match': etag } }), null)).toBe(false);
  });

  it('builds stable propfind etags distinct per input', () => {
    const a = etagForPropfind('alice/demo', 'docs', '1', hashBody('<a/>'));
    expect(a).toBe(etagForPropfind('alice/demo', 'docs', '1', hashBody('<a/>')));
    expect(a).not.toBe(etagForPropfind('alice/demo', 'docs', '0', hashBody('<a/>')));
    expect(a).not.toBe(etagForPropfind('alice/demo', 'other', '1', hashBody('<a/>')));
    expect(a).toMatch(/^W\/".+"$/);
  });

  it('assigns private cache-control per kind', () => {
    expect(cacheControlFor('file')).toContain('private');
    expect(cacheControlFor('propfind')).toContain('private');
    // A file's window is longer than a propfind's, and the difference is the point:
    // the body is immutable per etag while a multistatus reflects sibling changes.
    expect(cacheControlFor('file')).not.toBe(cacheControlFor('propfind'));
  });

  it('rejects a shape it does not know, rather than silently using a default', () => {
    // The parameter is the closed `CachedShape` union, so a typo is a compile error.
    // It was a bare `string` and any other value fell through to `max-age=30` —
    // this asserts that the type is doing the work, at runtime as well, because a
    // cast from untyped JSON would otherwise reintroduce the silent default.
    // @ts-expect-error deliberately wrong shape: proves the union is closed
    expect(() => cacheControlFor('meta')).toThrow();
  });

  it('round-trips base64 file bodies', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips propfind snapshots keyed by volume+path+depth+body', async () => {
    const cache = new KvCache(makeFakeKv());
    await expect(getCachedPropfind(cache, 'Alice', 'Demo', 'docs', '1', '<a/>')).resolves.toBeNull();
    await putCachedPropfind(cache, 'Alice', 'Demo', 'docs', '1', '<a/>', { body: '<xml/>', etag: 'W/"1"' });
    await expect(getCachedPropfind(cache, 'alice', 'demo', 'docs', '1', '<a/>')).resolves.toEqual({
      body: '<xml/>',
      etag: 'W/"1"',
    });
    // Different depth/body miss.
    await expect(getCachedPropfind(cache, 'alice', 'demo', 'docs', '0', '<a/>')).resolves.toBeNull();
    await expect(getCachedPropfind(cache, 'alice', 'demo', 'docs', '1', '<b/>')).resolves.toBeNull();
  });

  it('round-trips files as binary and skips oversize bodies', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    const bytes = new Uint8Array([104, 105]);
    await putCachedFile(cache, 'alice', 'demo', 'a.txt', bytes, 'text/plain', '"etag1"');
    await expect(getCachedFile(cache, 'Alice', 'Demo', 'a.txt')).resolves.toEqual({
      bytes,
      contentType: 'text/plain',
      etag: '"etag1"',
    });
    const big = new Uint8Array(MAX_CACHED_FILE_BYTES + 1);
    const before = kv.seen.length;
    await putCachedFile(cache, 'alice', 'demo', 'big.bin', big, 'application/octet-stream', '"big"');
    expect(kv.seen.length).toBe(before);
  });

  it('reads pre-binary base64 entries until their TTL expires', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    const bytes = new Uint8Array([104, 105]);
    await cache.putJson('asset', ['alice/demo', 'path:legacy.txt'], {
      b64: bytesToBase64(bytes),
      contentType: 'text/plain',
      etag: '"old"',
    });
    await expect(getCachedFile(cache, 'alice', 'demo', 'legacy.txt')).resolves.toEqual({
      bytes,
      contentType: 'text/plain',
      etag: '"old"',
    });
  });

  it('treats undecodable legacy entries and metadata-less binaries as misses', async () => {
    const kv = makeFakeKv();
    const cache = new KvCache(kv);
    await cache.putJson('asset', ['alice/demo', 'path:bad.txt'], { b64: '!!!not base64!!!', etag: '"e"' });
    await expect(getCachedFile(cache, 'alice', 'demo', 'bad.txt')).resolves.toBeNull();
    await kv.put(buildKvKey('asset', ['alice/demo', 'path:bare.bin']), new Uint8Array([1]).slice().buffer as ArrayBuffer);
    await expect(getCachedFile(cache, 'alice', 'demo', 'bare.bin')).resolves.toBeNull();
  });

  it('invalidates the volume prop+file caches', async () => {
    const cache = new KvCache(makeFakeKv());
    await putCachedPropfind(cache, 'alice', 'demo', 'docs', '1', '<a/>', { body: '<xml/>', etag: 'W/"1"' });
    await putCachedFile(cache, 'alice', 'demo', 'a.txt', new Uint8Array([1]), 'text/plain', '"e"');
    // Sibling volume untouched.
    await putCachedPropfind(cache, 'alice', 'other', 'docs', '1', '<a/>', { body: '<xml/>', etag: 'W/"1"' });
    await invalidateVolumeCaches(cache, 'Alice', 'Demo');
    await expect(getCachedPropfind(cache, 'alice', 'demo', 'docs', '1', '<a/>')).resolves.toBeNull();
    await expect(getCachedFile(cache, 'alice', 'demo', 'a.txt')).resolves.toBeNull();
    await expect(getCachedPropfind(cache, 'alice', 'other', 'docs', '1', '<a/>')).resolves.toEqual({
      body: '<xml/>',
      etag: 'W/"1"',
    });
  });

  it('round-trips the volume list with case-insensitive email keys', async () => {
    const cache = new KvCache(makeFakeKv());
    await putCachedVolumeList(cache, 'Alice@Example.com', [{ fullName: 'alice/demo' }]);
    await expect(getCachedVolumeList(cache, 'alice@example.com')).resolves.toEqual([{ fullName: 'alice/demo' }]);
    await invalidateVolumeListCache(cache, 'ALICE@example.com');
    await expect(getCachedVolumeList(cache, 'alice@example.com')).resolves.toBeNull();
  });

  it('stays fail-soft when the KV backend throws', async () => {
    const boom = (): Promise<never> => Promise.reject(new Error('boom'));
    const failing: KvNamespaceLike = {
      get: boom as KvNamespaceLike['get'],
      put: boom,
      delete: boom,
      list: boom,
    };
    const cache = new KvCache(failing);
    await expect(getCachedPropfind(cache, 'a', 'b', '', '1', '<x/>')).resolves.toBeNull();
    await expect(getCachedFile(cache, 'a', 'b', 'f')).resolves.toBeNull();
    await expect(getCachedVolumeList(cache, 'a@x.com')).resolves.toBeNull();
    await expect(invalidateVolumeCaches(cache, 'a', 'b')).resolves.toBeUndefined();
    await expect(invalidateVolumeListCache(cache, 'a@x.com')).resolves.toBeUndefined();
  });
});
