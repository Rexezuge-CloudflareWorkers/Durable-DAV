import { AbstractEntrypointWorker } from '@rexezuge/runtime';
import { fromHono } from 'chanfana';
import type { HonoOpenAPIRouterType } from 'chanfana';
import { Hono } from 'hono';
import { AppConfiguration } from '@durable-dav/backend-runtime/config';
import { ErrorSanitizationUtil } from '@rexezuge/shared';
import { MiddlewareHandlers, registerRateLimits } from '@/middleware';
import { securityHeaders, sensitivePaths } from '@rexezuge/http';
import type { ApiEnv } from '@/types/ApiContext';
import { scopeMiddleware } from '@/middleware/scopeMiddleware';
import { registerDavRoutes } from './routes/DavRoutes';
import { registerVolumeRoutes } from './routes/VolumeRoutes';
import { registerVolumeBrowserRoutes } from './routes/VolumeBrowserRoutes';
import { registerCredentialRoutes } from './routes/CredentialRoutes';
import { registerReplicationRoutes } from './routes/ReplicationRoutes';
import { registerUserProfileRoutes } from './routes/UserRoutes';
import { DEPRECATION_HEADERS, DEPRECATION_HTML } from './deprecationNotice';

type AppRouter = HonoOpenAPIRouterType<ApiEnv>;

class DurableDavWorker extends AbstractEntrypointWorker {
  protected readonly app: AppRouter;
  private configChecked = false;

  constructor() {
    super();

    const app = new Hono<ApiEnv>();

    app.use('*', securityHeaders(sensitivePaths('/user/')));
    app.onError((error, c) => {
      console.error('Unhandled worker error', ErrorSanitizationUtil.stackForLog(error));
      return c.json({ Exception: { Type: 'InternalServerError', Message: 'Internal Server Error.' } }, 500);
    });

    app.get('/health', (c) => c.json({ ok: true, service: 'durable-dav' }));

    // The built-in web UI is soft-deprecated. The home page points at the
    // supported UI (Durable-DAV-Router); `/new`, `/settings` and the single
    // profile segment have no route at all and fall through to Hono's 404.
    // No per-request scope or SPA build artifact is needed for the notice.
    app.get('/', (c) => {
      for (const [name, value] of Object.entries(DEPRECATION_HEADERS)) c.header(name, value);
      return c.html(DEPRECATION_HTML);
    });

    app.use('*', scopeMiddleware);

    // Abuse control. Must sit after `scopeMiddleware` so the limiter can read
    // the authenticated identity, and before every route so no endpoint can
    // be added without inheriting a limit.
    registerRateLimits(app);

    app.use('/user/*', MiddlewareHandlers.userAuthentication());

    registerVolumeRoutes(app);
    registerVolumeBrowserRoutes(app);
    registerCredentialRoutes(app);
    registerReplicationRoutes(app);
    registerUserProfileRoutes(app);

    // Volume paths always go to the DO. The SPA's HTML content negotiation is
    // gone, so a browser navigation to a collection gets the DO's own small
    // HTML listing while WebDAV clients keep the multistatus/file bodies.
    registerDavRoutes(app);

    const openapi: AppRouter = fromHono(app, { docs_url: '/docs' });
    this.app = openapi;
  }

  protected async onRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Fail-fast configuration check, once per isolate. `AppConfiguration.validate`
    // documents itself as "call at worker startup"; it was never called, so a
    // typo like `MAX_FILE_BYTES=banana` silently became the 50 MB default in
    // production and only ever surfaced in a test.
    if (!this.configChecked) {
      this.configChecked = true;
      for (const warning of AppConfiguration.fromEnv(env).validate()) console.error(warning);
    }
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
          // `!res.ok` already excludes 2xx, so the old `&& res.status !== 202`
          // guard was unreachable — and it would have suppressed the log for
          // exactly the case that matters (a 202 is a normal single-flight
          // skip, not an error).
          if (!res.ok) console.error('CronTasksWorker error', res.status);
        })
        .catch((error: unknown) => console.error('Cron invoke failed', error)),
    );
    return Promise.resolve();
  }
}

export { DurableDavWorker };
