import { AbstractEntrypointWorker } from '@duradav/backend-runtime/base';
import { fromHono } from 'chanfana';
import type { HonoOpenAPIRouterType } from 'chanfana';
import { Hono } from 'hono';
import { MiddlewareHandlers, securityHeaders } from '@/middleware';
import { scopeMiddleware } from '@/middleware/scopeMiddleware';
import { RESERVED_NAMESPACE_NAMES } from '@duradav/shared/constants';
import { registerDavRoutes } from './routes/DavRoutes';
import { registerVolumeRoutes } from './routes/VolumeRoutes';
import { registerTokenRoutes } from './routes/TokenRoutes';
import { registerUserProfileRoutes } from './routes/UserRoutes';
import { SPA_HTML } from '@/generated/spa-shell';

type AppRouter = HonoOpenAPIRouterType<{
  Bindings: Env;
  Variables: { AuthenticatedUserEmailAddress: string };
}>;

function acceptsHtml(request: Request): boolean {
  return (request.headers.get('Accept') ?? '').includes('text/html');
}

class DuraDavWorker extends AbstractEntrypointWorker {
  protected readonly app: AppRouter;

  constructor() {
    super();

    const app = new Hono<{
      Bindings: Env;
      Variables: { AuthenticatedUserEmailAddress: string };
    }>();

    app.use('*', securityHeaders());
    app.onError((error, c) => {
      console.error('Unhandled worker error', error instanceof Error ? (error.stack ?? error.message) : error);
      return c.json({ Exception: { Type: 'InternalServerError', Message: 'Internal Server Error.' } }, 500);
    });

    app.get('/health', (c) => c.json({ ok: true, service: 'duradav' }));

    // Web SPA shell (Vite build embeds `apps/web/dist/index.html` into
    // `apps/api/src/generated/spa-shell.ts`; no per-request scope needed).
    app.get('/', (c) => c.html(SPA_HTML));
    app.get('/new', (c) => c.html(SPA_HTML));
    app.get('/settings', (c) => c.html(SPA_HTML));
    // Single-segment profile shell — never shadow reserved API/UI roots
    // (`/health`, `/docs`, `/user`, …). Reserved names fall through so the
    // exact routes (including fromHono's `/docs`, registered later) win.
    app.get('/:username', async (c, next) => {
      const segment = (c.req.param('username') ?? '').toLowerCase();
      if (RESERVED_NAMESPACE_NAMES.has(segment)) {
        await next();
        return;
      }
      return c.html(SPA_HTML);
    });

    app.use('*', scopeMiddleware);

    app.use('/user/*', MiddlewareHandlers.userAuthentication());

    registerVolumeRoutes(app);
    registerTokenRoutes(app);
    registerUserProfileRoutes(app);

    // Volume-root content negotiation (recommended option): browser document
    // navigations (`Accept: text/html`) get the SPA shell, whose VolumeView
    // drives subpaths client-side via `?path=`; WebDAV and file clients
    // (`Accept: */*`, `Depth`, …) fall through to the DO forward below.
    // Registered after `/user/*` so API JSON responses always win.
    app.use('/:owner/:volume', async (c, next) => {
      if (c.req.method === 'GET' && acceptsHtml(c.req.raw)) return c.html(SPA_HTML);
      await next();
    });
    registerDavRoutes(app);

    const openapi: AppRouter = fromHono(app, { docs_url: '/docs' });
    this.app = openapi;
  }

  protected async onRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return this.app.fetch(request, env, ctx);
  }

  protected onScheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const id = env.CRON_TASKS.idFromName('global');
    const stub = env.CRON_TASKS.get(id);
    ctx.waitUntil(
      stub
        .fetch(
          new Request('https://do/run', {
            method: 'POST',
            body: JSON.stringify({ cron: event.cron, scheduledTime: event.scheduledTime }),
          }),
        )
        .then((res: Response) => {
          if (!res.ok && res.status !== 202) console.error('CronTasksWorker error', res.status);
        })
        .catch((error: unknown) => console.error('Cron invoke failed', error)),
    );
    return Promise.resolve();
  }
}

export { DuraDavWorker };
