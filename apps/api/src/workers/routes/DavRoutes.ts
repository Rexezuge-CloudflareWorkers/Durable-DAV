import { Tokens } from '@durable-dav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';
import type { ApiApp, ApiContext } from '@/types/ApiContext';
import { davAuthForVolume } from '@/middleware/DavAuth';
import type { DavAuthResult } from '@/middleware/DavAuth';
import { getVolumeStub } from '../doStubs';
import { DAV_CLASS, SUPPORT_METHODS, applyCors } from '@durable-dav/webdav';
import {
  MAX_CACHED_FILE_BYTES,
  base64ToBytes,
  cacheControlFor,
  etagForPropfind,
  getCachedFile,
  getCachedPropfind,
  hashBody,
  invalidateVolumeCaches,
  invalidatesReadCache,
  isFresh,
  putCachedFile,
  putCachedPropfind,
} from './DavReadCache';

type App = ApiApp;

/**
 * The real Hono context, not a hand-rolled partial interface. The previous
 * `DavContext` declared only `req.{method,url,raw,param,text}` and `env`, which
 * meant `get`/`set` were invisible to the type system and every call into
 * `BaseRoute.getScope` / `davAuthForVolume` needed an `as never` cast to bridge
 * the gap. 25 of those casts existed across this package; the shared
 * `ApiContext` type removes the need for them.
 */
type DavContext = ApiContext;

function isDavMethod(method: string): boolean {
  return SUPPORT_METHODS.includes(method);
}

function needsWrite(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS', 'PROPFIND'].includes(method);
}

function stripSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start += 1;
  while (end > start && value[end - 1] === '/') end -= 1;
  return value.slice(start, end);
}

function davHeaders(c: DavContext, auth: DavAuthResult, base: string, inner: string): Headers {
  const h = new Headers(c.req.raw.headers);
  h.set('X-Dav-Base', base);
  h.set('X-Dav-Path', inner);
  // Always overwrite. Setting it only when authenticated let a client-supplied
  // `X-Dav-User: admin@…` through untouched on an anonymous read of a public
  // volume. Nothing consumes it today, but it is a header-injection primitive
  // one refactor away from mattering.
  h.set('X-Dav-User', auth.userEmail ?? '');
  // The DO never reads Authorization; do not hand credentials down.
  h.delete('Authorization');
  return h;
}

/**
 * 200/304 response builder for cached DAV reads.
 *
 * Single place for the header set, so the 200 and 304 arms cannot drift.
 * Previously the 304 arm set only `ETag`, omitting the `Cache-Control` the
 * 200 arm sent, and the 200 header block was written three separate times
 * with subtly different field sets.
 */
function respondFromCache(
  kind: 'file' | 'propfind',
  entry: { etag: string; contentType?: string | null; body?: string; b64?: string },
  request: Request,
  headOnly: boolean,
): Response {
  if (isFresh(request, entry.etag)) {
    // RFC 9110 §15.4.5: a 304 must carry the caching directives it would have
    // sent on a 200, or the client falls back to heuristic freshness.
    return new Response(null, { status: 304, headers: { ETag: entry.etag, 'Cache-Control': cacheControlFor(kind) } });
  }
  if (kind === 'propfind') {
    return new Response(entry.body ?? '', {
      status: 207,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        ETag: entry.etag,
        'Cache-Control': cacheControlFor('propfind'),
      },
    });
  }
  const bytes = base64ToBytes(entry.b64 ?? '');
  return new Response(headOnly ? null : (bytes as BodyInit), {
    status: 200,
    headers: {
      'Content-Type': entry.contentType ?? 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      ETag: entry.etag,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControlFor('file'),
    },
  });
}

/**
200/304 for a body already materialised from the DO.
*/
function respondFromBytes(
  cacheKind: 'file' | 'propfind',
  status: 200 | 207,
  bytes: ArrayBuffer | string,
  etag: string,
  extra: Record<string, string>,
  request: Request,
  headOnly: boolean,
): Response {
  if (isFresh(request, etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cacheControlFor(cacheKind) } });
  }
  const length = typeof bytes === 'string' ? new TextEncoder().encode(bytes).byteLength : bytes.byteLength;
  return new Response(headOnly ? null : (bytes as BodyInit), {
    status,
    headers: {
      'Content-Type': cacheKind === 'propfind' ? 'application/xml; charset=utf-8' : 'application/octet-stream',
      'Content-Length': String(length),
      ETag: etag,
      'Cache-Control': cacheControlFor(cacheKind),
      ...extra,
    },
  });
}

async function serveGet(
  c: DavContext,
  stub: ReturnType<typeof getVolumeStub>,
  auth: DavAuthResult,
  base: string,
  inner: string,
  headOnly: boolean,
): Promise<Response> {
  const cache = BaseRoute.getScope(c).get(Tokens.KvCache);
  const hasRange = c.req.raw.headers.has('Range');
  // Range slices bypass the cache (low frequency, per-request offsets).
  if (!hasRange) {
    try {
      const cached = await getCachedFile(cache, auth.owner, auth.volume, inner);
      if (cached) {
        return applyCors(respondFromCache('file', cached, c.req.raw, headOnly), c.req.raw);
      }
    } catch {
      // Fail-soft: fall through to the DO loader.
    }
  }
  const forward = new Request(c.req.url, {
    method: headOnly ? 'HEAD' : 'GET',
    headers: davHeaders(c, auth, base, inner),
  });
  const response = await stub.fetch(forward);
  // Cache small 200 file bodies (skip HTML collection listings + ranges).
  if (!headOnly && !hasRange && response.status === 200) {
    const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
    const etag = response.headers.get('ETag');
    if (etag && !contentType.includes('text/html')) {
      // Consume defensively: a failure here must not leave us trying to re-use
      // an already-locked body stream (which threw a TypeError and surfaced as
      // a 500 via the catch's "fall through with the original response").
      const buf = await response.arrayBuffer().catch(() => null);
      if (buf) {
        if (buf.byteLength <= MAX_CACHED_FILE_BYTES) {
          await putCachedFile(cache, auth.owner, auth.volume, inner, new Uint8Array(buf), contentType, etag).catch(() => undefined);
        }
        // Build an explicit header set: `buf` is the runtime-*decoded* body, so
        // cloning the DO's headers verbatim could carry a now-wrong
        // `Content-Length`, a stale `Content-Encoding`, or hop-by-hop headers.
        return applyCors(
          respondFromBytes('file', 200, buf, etag, { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' }, c.req.raw, headOnly),
          c.req.raw,
        );
      }
    }
  }
  return applyCors(response, c.req.raw);
}

async function servePropfind(
  c: DavContext,
  stub: ReturnType<typeof getVolumeStub>,
  auth: DavAuthResult,
  base: string,
  inner: string,
): Promise<Response> {
  const cache = BaseRoute.getScope(c).get(Tokens.KvCache);
  const depth = c.req.raw.headers.get('Depth') ?? 'infinity';
  // Only Depth 0/1 are cached; infinity walks can exceed KV limits.
  const cacheable = depth === '0' || depth === '1';
  // Read once as bytes: `c.req.text()` decoded as UTF-8 and re-encoding it
  // corrupted any non-UTF-8 XML body, and the same buffer feeds the cache key.
  const bodyBytes = await c.req.arrayBuffer().catch(() => new ArrayBuffer(0));
  const bodyText = new TextDecoder().decode(bodyBytes);
  if (cacheable) {
    try {
      const cached = await getCachedPropfind(cache, auth.owner, auth.volume, inner, depth, bodyText);
      if (cached) {
        return applyCors(respondFromCache('propfind', cached, c.req.raw, false), c.req.raw);
      }
    } catch {
      // Fail-soft: fall through to the DO loader.
    }
  }
  const forward = new Request(c.req.url, {
    method: 'PROPFIND',
    headers: davHeaders(c, auth, base, inner),
    body: bodyBytes.byteLength > 0 ? bodyBytes : undefined,
    duplex: 'half',
  } as RequestInit);
  const response = await stub.fetch(forward);
  if (cacheable && response.status === 207) {
    const text = await response.text().catch(() => null);
    if (text !== null) {
      const etag = response.headers.get('ETag') ?? etagForPropfind(`${auth.owner}/${auth.volume}`.toLowerCase(), inner, depth, hashBody(bodyText));
      await putCachedPropfind(cache, auth.owner, auth.volume, inner, depth, bodyText, { body: text, etag }).catch(() => undefined);
      return applyCors(respondFromBytes('propfind', 207, text, etag, {}, c.req.raw, false), c.req.raw);
    }
  }
  return applyCors(response, c.req.raw);
}

async function handleDav(c: DavContext, owner: string, volume: string, inner: string): Promise<Response> {
  const method = c.req.method;
  if (!isDavMethod(method)) {
    return applyCors(
      new Response('Method Not Allowed', { status: 405, headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS } }),
      c.req.raw,
    );
  }
  // `OPTIONS` is a capability probe, not an access to resource content. Many
  // DAV clients (and Windows/Office discovery) send it unauthenticated to learn
  // the compliance class; answering 401 on a private volume broke discovery
  // outright. Advertise capabilities without touching volume state.
  if (method === 'OPTIONS') {
    return applyCors(
      new Response(null, {
        status: 200,
        headers: {
          Allow: SUPPORT_METHODS.join(', '),
          DAV: DAV_CLASS,
          'MS-Author-Via': 'DAV',
          'Content-Length': '0',
        },
      }),
      c.req.raw,
    );
  }
  const auth = await davAuthForVolume(c, owner, volume, needsWrite(method));
  if (auth instanceof Response) return applyCors(auth, c.req.raw);
  const stub = getVolumeStub(c.env, auth.owner, auth.volume);
  const base = `/${auth.owner}/${auth.volume}`;
  if (method === 'GET' || method === 'HEAD') {
    return serveGet(c, stub, auth, base, inner, method === 'HEAD');
  }
  if (method === 'PROPFIND') {
    return servePropfind(c, stub, auth, base, inner);
  }
  const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const forward = new Request(c.req.url, {
    method,
    headers: davHeaders(c, auth, base, inner),
    body: hasBody ? c.req.raw.body : undefined,
    ...(hasBody && { duplex: 'half' }),
  });
  const response = await stub.fetch(forward);
  // Only content-changing methods drop the read cache (see
  // CONTENT_INVALIDATING_METHODS). This used to run for every remaining
  // method, which included OPTIONS/LOCK/UNLOCK.
  if (invalidatesReadCache(method)) {
    try {
      const cache = BaseRoute.getScope(c).get(Tokens.KvCache);
      await invalidateVolumeCaches(cache, auth.owner, auth.volume);
    } catch {
      // Never break writes on cache errors.
    }
  }
  return applyCors(response, c.req.raw);
}

function registerDavRoutes(app: App): void {
  // WebDAV volume surface: /:owner/:volume/* (multi-volume from day one).
  // Depth handling lives in the DO; the front adds fail-soft KV caching
  // for GET/PROPFIND and invalidation on writes (Git RepoReadCache pattern).
  const methods = [...SUPPORT_METHODS] as never[];
  app.on(methods, '/:owner/:volume/*', async (c) => {
    const owner = c.req.param('owner') ?? '';
    const volume = c.req.param('volume') ?? '';
    const url = new URL(c.req.url);
    const base = `/${owner}/${volume}`;
    // Preserve display case for the base until auth resolves canonical names;
    // `handleDav` re-derives the canonical base from the auth result.
    const suffix = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : '';
    const inner = stripSlashes(suffix);
    return handleDav(c, owner, volume, inner);
  });

  app.on(methods, '/:owner/:volume', async (c) => {
    const owner = c.req.param('owner') ?? '';
    const volume = c.req.param('volume') ?? '';
    return handleDav(c, owner, volume, '');
  });

  // Terminal catch-all. Without it, a non-DAV method on a volume path matched
  // no route and fell through to Hono's default 404, so the 405 the code
  // already contained was unreachable and clients saw "not found" for a
  // resource that plainly exists.
  const methodNotAllowed = (c: DavContext): Response =>
    applyCors(
      new Response('Method Not Allowed', { status: 405, headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS } }),
      c.req.raw,
    );
  app.all('/:owner/:volume', methodNotAllowed as never);
  app.all('/:owner/:volume/*', methodNotAllowed as never);
}

export { registerDavRoutes };
export type { App };
