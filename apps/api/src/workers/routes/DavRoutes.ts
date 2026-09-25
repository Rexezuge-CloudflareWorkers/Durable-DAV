import type { Hono } from 'hono';
import { Tokens } from '@durable-dav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';
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
  isFresh,
  putCachedFile,
  putCachedPropfind,
} from './DavReadCache';

type App = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;
interface DavContext {
  req: {
    method: string;
    url: string;
    raw: Request;
    param: (name: string) => string | undefined;
    text: () => Promise<string>;
  };
  env: Env;
}

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
  if (auth.userEmail) h.set('X-Dav-User', auth.userEmail);
  return h;
}

async function serveGet(
  c: DavContext,
  stub: ReturnType<typeof getVolumeStub>,
  auth: DavAuthResult,
  base: string,
  inner: string,
  headOnly: boolean,
): Promise<Response> {
  const cache = BaseRoute.getScope(c as never).get(Tokens.KvCache);
  const hasRange = c.req.raw.headers.has('Range');
  // Range slices bypass the cache (low frequency, per-request offsets).
  if (!hasRange) {
    try {
      const cached = await getCachedFile(cache, auth.owner, auth.volume, inner);
      if (cached) {
        if (isFresh(c.req.raw, cached.etag)) {
          return applyCors(new Response(null, { status: 304, headers: { ETag: cached.etag } }), c.req.raw);
        }
        if (headOnly) {
          return applyCors(
            new Response(null, {
              status: 200,
              headers: {
                'Content-Type': cached.contentType,
                'Content-Length': String(base64ToBytes(cached.b64).byteLength),
                ETag: cached.etag,
                'Accept-Ranges': 'bytes',
                'Cache-Control': cacheControlFor('file'),
              },
            }),
            c.req.raw,
          );
        }
        const bytes = base64ToBytes(cached.b64);
        return applyCors(
          new Response(bytes as BodyInit, {
            status: 200,
            headers: {
              'Content-Type': cached.contentType,
              'Content-Length': String(bytes.byteLength),
              ETag: cached.etag,
              'Accept-Ranges': 'bytes',
              'Cache-Control': cacheControlFor('file'),
            },
          }),
          c.req.raw,
        );
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
      try {
        const buf = await response.arrayBuffer();
        if (buf.byteLength <= MAX_CACHED_FILE_BYTES) {
          await putCachedFile(cache, auth.owner, auth.volume, inner, new Uint8Array(buf), contentType, etag);
        }
        if (isFresh(c.req.raw, etag)) {
          return applyCors(new Response(null, { status: 304, headers: { ETag: etag } }), c.req.raw);
        }
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', cacheControlFor('file'));
        return applyCors(new Response(buf, { status: 200, headers }), c.req.raw);
      } catch {
        // Fall through with the original response below.
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
  const cache = BaseRoute.getScope(c as never).get(Tokens.KvCache);
  const depth = c.req.raw.headers.get('Depth') ?? 'infinity';
  // Only Depth 0/1 are cached; infinity walks can exceed KV limits.
  const cacheable = depth === '0' || depth === '1';
  let bodyText = '';
  try {
    bodyText = await c.req.text();
  } catch {
    bodyText = '';
  }
  if (cacheable) {
    try {
      const cached = await getCachedPropfind(cache, auth.owner, auth.volume, inner, depth, bodyText);
      if (cached) {
        if (isFresh(c.req.raw, cached.etag)) {
          return applyCors(new Response(null, { status: 304, headers: { ETag: cached.etag } }), c.req.raw);
        }
        return applyCors(
          new Response(cached.body, {
            status: 207,
            headers: {
              'Content-Type': 'application/xml; charset=utf-8',
              ETag: cached.etag,
              'Cache-Control': cacheControlFor('propfind'),
            },
          }),
          c.req.raw,
        );
      }
    } catch {
      // Fail-soft: fall through to the DO loader.
    }
  }
  const forward = new Request(c.req.url, {
    method: 'PROPFIND',
    headers: davHeaders(c, auth, base, inner),
    body: bodyText,
    duplex: 'half',
  } as RequestInit);
  const response = await stub.fetch(forward);
  if (cacheable && response.status === 207) {
    try {
      const text = await response.text();
      const etag = response.headers.get('ETag') ?? etagForPropfind(`${auth.owner}/${auth.volume}`.toLowerCase(), inner, depth, hashBody(bodyText));
      await putCachedPropfind(cache, auth.owner, auth.volume, inner, depth, bodyText, { body: text, etag });
      if (isFresh(c.req.raw, etag)) {
        return applyCors(new Response(null, { status: 304, headers: { ETag: etag } }), c.req.raw);
      }
      return applyCors(
        new Response(text, {
          status: 207,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            ETag: etag,
            'Cache-Control': cacheControlFor('propfind'),
          },
        }),
        c.req.raw,
      );
    } catch {
      // Fall through with the original response below.
    }
  }
  return applyCors(response, c.req.raw);
}

async function handleDav(c: DavContext, owner: string, volume: string, inner: string, baseOverride?: string): Promise<Response> {
  const method = c.req.method;
  if (!isDavMethod(method)) {
    return applyCors(
      new Response('Method Not Allowed', { status: 405, headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS } }),
      c.req.raw,
    );
  }
  const auth = await davAuthForVolume(c as never, owner, volume, needsWrite(method));
  if (auth instanceof Response) return applyCors(auth, c.req.raw);
  const stub = getVolumeStub(c.env, auth.owner, auth.volume);
  const base = baseOverride ?? `/${auth.owner}/${auth.volume}`;
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
  // Writes invalidate the volume read cache (fail-soft, best-effort).
  try {
    const cache = BaseRoute.getScope(c as never).get(Tokens.KvCache);
    await invalidateVolumeCaches(cache, auth.owner, auth.volume);
  } catch {
    // Never break writes on cache errors.
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
}

export { registerDavRoutes };
export type { App };
