import type { KvCache } from '@durable-dav/backend-runtime/kv';
import { fnv1aHex } from '@durable-dav/backend-runtime/kv';
import { normalizeVolumeKey } from '@durable-dav/webdav';

// KV-backed read cache for DAV RPCs (Git `RepoReadCache` pattern).
// D1/DO stay authoritative; KV is loss-tolerant. All keys use the canonical
// lowercase volume key so `Foo/Bar` and `foo/bar` share one entry, matching
// `DAV_VOLUME.getByName` sharding. PROPFIND snapshots live 120s (`davProp`
// domain) and are invalidated on write; small file bodies live 300s
// (`davFile` domain) keyed by volume+path; volume list/detail snapshots live
// 60s (`davMeta` domain) keyed by owner email / volume key.

const DAV_PROP_TTL_SECONDS = 120;
const DAV_FILE_TTL_SECONDS = 300;
const DAV_META_TTL_SECONDS = 60;
// Upper bound for KV-cached file bodies (raw bytes). `davFile` caps at
// 1MiB; base64 inflates ~33%, so only small responses are cached.
// Large files bypass the cache and always hit the DO.
const MAX_CACHED_FILE_BYTES = 700_000;

function cacheKeyForVolume(owner: string, volume: string): string {
  return normalizeVolumeKey(owner, volume);
}

function isFresh(request: Request, etag: string | null): boolean {
  if (!etag) return false;
  const incoming = request.headers.get('If-None-Match');
  return incoming ? incoming.split(',').some((part) => part.trim() === etag || part.trim() === '*') : false;
}

function cacheControlFor(kind: string): string {
  if (kind === 'file') return 'private, max-age=300, must-revalidate';
  return kind === 'propfind' ? 'private, max-age=60, must-revalidate' : 'private, max-age=30, must-revalidate';
}

function withEtagHeaders(response: Response, etag: string, cacheControl: string): Response {
  const headers = new Headers(response.headers);
  headers.set('ETag', etag);
  headers.set('Cache-Control', cacheControl);
  return new Response(response.body, { status: response.status, headers });
}

function hashBody(value: string): string {
  return fnv1aHex(value);
}

function propfindCacheParts(volumeKey: string, innerPath: string, depth: string, body: string): readonly string[] {
  return [volumeKey, `path:${innerPath}`, `depth:${depth}`, hashBody(body)];
}

function fileCacheParts(volumeKey: string, innerPath: string): readonly string[] {
  return [volumeKey, `path:${innerPath}`];
}

interface CachedPropfind {
  body: string;
  etag: string;
}

interface CachedFile {
  b64: string;
  contentType: string;
  etag: string;
}

function etagForPropfind(volumeKey: string, innerPath: string, depth: string, bodyHash: string): string {
  return `W/"prop-${fnv1aHex(`${volumeKey}:${innerPath}:${depth}:${bodyHash}`)}"`;
}

async function getCachedPropfind(
  cache: KvCache,
  owner: string,
  volume: string,
  innerPath: string,
  depth: string,
  body: string,
): Promise<CachedPropfind | null> {
  try {
    return await cache.getJson<CachedPropfind>('davProp', propfindCacheParts(cacheKeyForVolume(owner, volume), innerPath, depth, body));
  } catch {
    return null;
  }
}

async function putCachedPropfind(
  cache: KvCache,
  owner: string,
  volume: string,
  innerPath: string,
  depth: string,
  body: string,
  entry: CachedPropfind,
): Promise<void> {
  try {
    await cache.putJson('davProp', propfindCacheParts(cacheKeyForVolume(owner, volume), innerPath, depth, body), entry, {
      ttlSeconds: DAV_PROP_TTL_SECONDS,
    });
  } catch {
    // Best-effort cache population.
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = (binary.codePointAt(i) ?? 0) & 0xff;
  return out;
}

async function getCachedFile(cache: KvCache, owner: string, volume: string, innerPath: string): Promise<CachedFile | null> {
  try {
    return await cache.getJson<CachedFile>('davFile', fileCacheParts(cacheKeyForVolume(owner, volume), innerPath));
  } catch {
    return null;
  }
}

async function putCachedFile(
  cache: KvCache,
  owner: string,
  volume: string,
  innerPath: string,
  bytes: Uint8Array,
  contentType: string,
  etag: string,
): Promise<void> {
  if (bytes.byteLength > MAX_CACHED_FILE_BYTES) return;
  try {
    await cache.putJson(
      'davFile',
      fileCacheParts(cacheKeyForVolume(owner, volume), innerPath),
      { b64: bytesToBase64(bytes), contentType, etag } satisfies CachedFile,
      { ttlSeconds: DAV_FILE_TTL_SECONDS },
    );
  } catch {
    // Best-effort cache population.
  }
}

async function invalidateVolumeCaches(cache: KvCache, owner: string, volume: string): Promise<void> {
  const key = cacheKeyForVolume(owner, volume);
  try {
    await cache.purgePrefix('davProp', [key]);
  } catch {
    // Best-effort invalidation.
  }
  try {
    await cache.purgePrefix('davFile', [key]);
  } catch {
    // Best-effort invalidation.
  }
  try {
    await cache.del('davMeta', ['volume', key]);
  } catch {
    // Best-effort invalidation.
  }
}

async function invalidateVolumeListCache(cache: KvCache, ownerEmail: string): Promise<void> {
  try {
    await cache.del('davMeta', ['volumes', ownerEmail.toLowerCase()]);
  } catch {
    // Best-effort invalidation.
  }
}

async function getCachedVolumeList<T>(cache: KvCache, ownerEmail: string): Promise<T | null> {
  try {
    return await cache.getJson<T>('davMeta', ['volumes', ownerEmail.toLowerCase()]);
  } catch {
    return null;
  }
}

async function putCachedVolumeList(cache: KvCache, ownerEmail: string, value: unknown): Promise<void> {
  try {
    await cache.putJson('davMeta', ['volumes', ownerEmail.toLowerCase()], value, { ttlSeconds: DAV_META_TTL_SECONDS });
  } catch {
    // Best-effort cache population.
  }
}

async function getCachedVolumeDetail<T>(cache: KvCache, owner: string, volume: string): Promise<T | null> {
  try {
    return await cache.getJson<T>('davMeta', ['volume', cacheKeyForVolume(owner, volume)]);
  } catch {
    return null;
  }
}

async function putCachedVolumeDetail(cache: KvCache, owner: string, volume: string, value: unknown): Promise<void> {
  try {
    await cache.putJson('davMeta', ['volume', cacheKeyForVolume(owner, volume)], value, { ttlSeconds: DAV_META_TTL_SECONDS });
  } catch {
    // Best-effort cache population.
  }
}

async function invalidateVolumeDetailCache(cache: KvCache, owner: string, volume: string): Promise<void> {
  try {
    await cache.del('davMeta', ['volume', cacheKeyForVolume(owner, volume)]);
  } catch {
    // Best-effort invalidation.
  }
}

export {
  DAV_PROP_TTL_SECONDS,
  DAV_FILE_TTL_SECONDS,
  DAV_META_TTL_SECONDS,
  MAX_CACHED_FILE_BYTES,
  cacheKeyForVolume,
  isFresh,
  cacheControlFor,
  withEtagHeaders,
  hashBody,
  etagForPropfind,
  getCachedPropfind,
  putCachedPropfind,
  getCachedFile,
  putCachedFile,
  invalidateVolumeCaches,
  invalidateVolumeListCache,
  getCachedVolumeList,
  putCachedVolumeList,
  getCachedVolumeDetail,
  putCachedVolumeDetail,
  invalidateVolumeDetailCache,
  bytesToBase64,
  base64ToBytes,
};
export type { CachedPropfind, CachedFile };
