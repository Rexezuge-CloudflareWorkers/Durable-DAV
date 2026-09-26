import { Tokens } from '@durable-dav/backend-services/composition';
import { SUPPORT_METHODS, DAV_CLASS } from '@durable-dav/webdav';
import type { ApiApp, ApiContext } from '@/types/ApiContext';
import { getVolumeStub } from '../doStubs';
import { invalidateVolumeCaches, invalidatesReadCache } from './DavReadCache';
import { VolumeScopedRoute } from './VolumeScopedRoute';
import type { VolumeRequestContext } from './VolumeScopedRoute';

type App = ApiApp;

function stripSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start += 1;
  while (end > start && value[end - 1] === '/') end -= 1;
  return value.slice(start, end);
}

function innerFromPath(pathname: string): string {
  // Browser prefix is /user/volumes/:owner/:volume/files[/inner...].
  // Split on '/' so owner/volume case or encoding never breaks extraction.
  const parts = stripSlashes(pathname).split('/');
  return parts.length <= 5 ? '' : parts.slice(5).join('/');
}

/**
 * Rewrite a browser-shaped `Destination` onto the DAV base.
 *
 * Returns `null` for a cross-origin destination. RFC 4918 §10.3 requires the
 * server to reject one it cannot map with `502 Bad Gateway`; forwarding the raw
 * header instead relied entirely on a same-origin check inside the DO, one
 * package away.
 */
function rewriteDestination(destinationHeader: string | null, requestUrl: string, davBase: string): string | null {
  if (!destinationHeader) return null;
  try {
    const destUrl = new URL(destinationHeader, requestUrl);
    if (destUrl.origin !== new URL(requestUrl).origin) return null;
    const parts = stripSlashes(destUrl.pathname).split('/');
    // Browser-style destination: /user/volumes/<owner>/<vol>/files/<inner>
    if (parts.length >= 5 && parts[0] === 'user' && parts[1] === 'volumes' && parts[4] === 'files') {
      const destInner = parts.slice(5).join('/');
      return `${destUrl.origin}${davBase}${destInner === '' ? '/' : `/${destInner}`}`;
    }
    return destUrl.href;
  } catch {
    return null;
  }
}

/**
 * Session-authenticated browser plane.
 *
 * Same DO content as the WebDAV plane, but authorised by the Access session so
 * a private bucket never answers 401 + `WWW-Authenticate` (which would pop a
 * native username/password prompt in the SPA's file browser).
 *
 * `404` is the not-owner response here, not `403`: this plane deliberately
 * hides existence so a stranger cannot probe which buckets exist. That was
 * previously duplicated inline and had already drifted from the credential
 * plane, which returned 403.
 */
class BrowserVolumeRoute extends VolumeScopedRoute {
  constructor() {
    super(404);
  }

  protected async run(c: ApiContext, { scope, email, row }: VolumeRequestContext): Promise<Response> {
    const method = c.req.method;
    if (!SUPPORT_METHODS.includes(method)) {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS },
      });
    }

    const stub = getVolumeStub(c.env, row.owner, row.name);
    const davBase = `/${row.owner}/${row.name}`;
    const url = new URL(c.req.url);
    const inner = innerFromPath(url.pathname);
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const destination = rewriteDestination(c.req.raw.headers.get('Destination'), c.req.url, davBase);
    if (destination === null && c.req.raw.headers.has('Destination')) {
      // §10.3: a destination on another server cannot be satisfied.
      return c.json({ Exception: { Type: 'BadGateway', Message: 'Cross-origin Destination' } }, 502);
    }
    // Forward to the DAV-base URL (not the browser URL): the DO falls back to
    // pathname parsing when X-Dav-Path is empty (root), and the browser prefix
    // would resolve to a nonexistent inner path there.
    const forward = new Request(`${url.origin}${davBase}/${inner}`, {
      method,
      headers: (() => {
        const h = new Headers(c.req.raw.headers);
        h.set('X-Dav-Base', davBase);
        h.set('X-Dav-Path', inner);
        h.set('X-Dav-User', email);
        if (destination) h.set('Destination', destination);
        // Never forward ambient Basic credentials into the DO on this plane;
        // session identity is authoritative here.
        h.delete('Authorization');
        return h;
      })(),
      body: hasBody ? c.req.raw.body : undefined,
      ...(hasBody && { duplex: 'half' }),
    });
    const response = await stub.fetch(forward);
    // Browser-plane writes share the same DO state as the WebDAV plane, so
    // invalidate the front read cache too (fail-soft, best-effort). Same
    // allow-list the WebDAV plane uses, so the two cannot drift.
    if (invalidatesReadCache(method)) {
      try {
        await invalidateVolumeCaches(scope.get(Tokens.KvCache), row.owner, row.name);
      } catch {
        // Never break writes on cache errors.
      }
    }
    return response;
  }
}

function registerVolumeBrowserRoutes(app: App): void {
  const handler = new BrowserVolumeRoute();
  const methods = [...SUPPORT_METHODS] as never[];
  app.on(methods, '/user/volumes/:owner/:volume/files', (c) => handler.handle(c));
  app.on(methods, '/user/volumes/:owner/:volume/files/*', (c) => handler.handle(c));
}

export { registerVolumeBrowserRoutes, innerFromPath, rewriteDestination };
