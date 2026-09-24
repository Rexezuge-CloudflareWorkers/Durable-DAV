import type { Hono } from 'hono';
import { davAuthForVolume } from '@/middleware/DavAuth';
import { getVolumeStub } from '../doStubs';
import { DAV_CLASS, SUPPORT_METHODS, applyCors } from '@duradav/webdav';

type App = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

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

function registerDavRoutes(app: App): void {
  // WebDAV volume surface: /:owner/:volume/* (multi-volume from day one).
  // Depth handling lives in the DO.
  const methods = [...SUPPORT_METHODS] as never[];
  app.on(methods, '/:owner/:volume/*', async (c) => {
    const owner = c.req.param('owner') ?? '';
    const volume = c.req.param('volume') ?? '';
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
    const base = `/${auth.owner}/${auth.volume}`;
    const url = new URL(c.req.url);
    const suffix = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : '';
    const inner = stripSlashes(suffix);
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const forward = new Request(c.req.url, {
      method,
      headers: (() => {
        const h = new Headers(c.req.raw.headers);
        h.set('X-Dav-Base', base);
        h.set('X-Dav-Path', inner);
        if (auth.userEmail) h.set('X-Dav-User', auth.userEmail);
        return h;
      })(),
      body: hasBody ? c.req.raw.body : undefined,
      ...(hasBody && { duplex: 'half' }),
    });
    const response = await stub.fetch(forward);
    return applyCors(response, c.req.raw);
  });

  app.on(methods, '/:owner/:volume', async (c) => {
    const owner = c.req.param('owner') ?? '';
    const volume = c.req.param('volume') ?? '';
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
    const base = `/${auth.owner}/${auth.volume}`;
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const forward = new Request(`${new URL(c.req.url).origin}${base}/`, {
      method,
      headers: (() => {
        const h = new Headers(c.req.raw.headers);
        h.set('X-Dav-Base', base);
        h.set('X-Dav-Path', '');
        if (auth.userEmail) h.set('X-Dav-User', auth.userEmail);
        return h;
      })(),
      body: hasBody ? c.req.raw.body : undefined,
      ...(hasBody && { duplex: 'half' }),
    });
    const response = await stub.fetch(forward);
    return applyCors(response, c.req.raw);
  });
}

export { registerDavRoutes };
export type { App };
