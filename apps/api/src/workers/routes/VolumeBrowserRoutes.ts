import type { Context, Hono } from 'hono';
import { Tokens } from '@durable-dav/backend-services/composition';
import { SUPPORT_METHODS, DAV_CLASS } from '@durable-dav/webdav';
import { BaseRoute } from '@/endpoints/IBaseRoute';
import { getVolumeStub } from '../doStubs';

type App = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;
type BrowserContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function stripSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start += 1;
  while (end > start && value[end - 1] === '/') end -= 1;
  return value.slice(start, end);
}

function isDavMethod(method: string): boolean {
  return SUPPORT_METHODS.includes(method);
}

function notFound(c: BrowserContext): Response {
  // Hide existence (Git `requireVisibleRepo` pattern): missing and forbidden
  // both surface as 404 JSON, never 401 + WWW-Authenticate so browsers never
  // show a native username/password prompt for the SPA file browser.
  return c.json({ Exception: { Type: 'NotFound', Message: 'Volume not found' } }, 404);
}

function innerFromPath(pathname: string): string {
  // Browser prefix is /user/volumes/:owner/:volume/files[/inner...].
  // Split on '/' so owner/volume case or encoding never breaks extraction.
  const parts = stripSlashes(pathname).split('/');
  if (parts.length <= 5) return '';
  return parts.slice(5).join('/');
}

function rewriteDestination(destinationHeader: string | null, requestUrl: string, davBase: string): string | null {
  if (!destinationHeader) return null;
  try {
    const destUrl = new URL(destinationHeader, requestUrl);
    const parts = stripSlashes(destUrl.pathname).split('/');
    // Browser-style destination: /user/volumes/<owner>/<vol>/files/<inner>
    if (parts.length >= 5 && parts[0] === 'user' && parts[1] === 'volumes' && parts[4] === 'files') {
      const destInner = parts.slice(5).join('/');
      const suffix = destInner === '' ? '/' : `/${destInner}`;
      return `${destUrl.origin}${davBase}${suffix}`;
    }
    return destinationHeader;
  } catch {
    return destinationHeader;
  }
}

async function browserHandler(c: BrowserContext): Promise<Response> {
  const method = c.req.method;
  if (!isDavMethod(method)) {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS },
    });
  }
  const email = c.get('AuthenticatedUserEmailAddress') as string | undefined;
  if (!email) {
    // Middleware normally rejects unauthenticated /user/* with JSON 401.
    // Defensive: same shape, no WWW-Authenticate.
    return c.json({ Exception: { Type: 'Unauthorized', Message: 'Unauthorized' } }, 401);
  }
  const owner = c.req.param('owner') ?? '';
  const volume = c.req.param('volume') ?? '';
  const scope = BaseRoute.getScope(c as never);
  const row = await scope
    .get(Tokens.VolumeService)
    .getVolume(owner, volume)
    .catch(() => null);
  if (!row) return notFound(c);
  if (row.owner_email.toLowerCase() !== email.toLowerCase()) return notFound(c);

  const stub = getVolumeStub(c.env, row.owner, row.name);
  const davBase = `/${row.owner}/${row.name}`;
  const url = new URL(c.req.url);
  const inner = innerFromPath(url.pathname);
  const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const rewrittenDest = rewriteDestination(c.req.raw.headers.get('Destination'), c.req.url, davBase);
  // Forward to the DAV-base URL (not the browser URL): the DO falls back to
  // pathname parsing when X-Dav-Path is empty (root), and the browser prefix
  // would resolve to a nonexistent inner path there.
  const davUrl = `${url.origin}${davBase}/${inner}`;
  const forward = new Request(davUrl, {
    method,
    headers: (() => {
      const h = new Headers(c.req.raw.headers);
      h.set('X-Dav-Base', davBase);
      h.set('X-Dav-Path', inner);
      h.set('X-Dav-User', email);
      if (rewrittenDest) h.set('Destination', rewrittenDest);
      // Never forward ambient Basic credentials into the DO on this plane;
      // session identity is authoritative here.
      h.delete('Authorization');
      return h;
    })(),
    body: hasBody ? c.req.raw.body : undefined,
    ...(hasBody && { duplex: 'half' }),
  });
  return stub.fetch(forward);
}

function registerVolumeBrowserRoutes(app: App): void {
  // Session-authenticated browser plane (Git read-model pattern):
  // same DO forward as DavRoutes but authed via Access session, private
  // volumes hide existence (404 JSON), never 401 + WWW-Authenticate.
  const methods = [...SUPPORT_METHODS] as never[];
  app.on(methods, '/user/volumes/:owner/:volume/files', browserHandler as never);
  app.on(methods, '/user/volumes/:owner/:volume/files/*', browserHandler as never);
}

export { registerVolumeBrowserRoutes };
