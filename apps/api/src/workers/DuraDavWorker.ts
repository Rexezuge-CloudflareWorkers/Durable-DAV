import { AbstractEntrypointWorker } from '@duradav/backend-runtime/base';
import { fromHono } from 'chanfana';
import type { HonoOpenAPIRouterType } from 'chanfana';
import { Hono } from 'hono';
import { MiddlewareHandlers, securityHeaders } from '@/middleware';
import { scopeMiddleware } from '@/middleware/scopeMiddleware';
import { Tokens } from '@duradav/backend-services/composition';
import { BaseRoute } from '@/endpoints/IBaseRoute';
import { registerDavRoutes } from './routes/DavRoutes';
import { registerVolumeRoutes } from './routes/VolumeRoutes';
import { registerTokenRoutes } from './routes/TokenRoutes';
import { registerUserProfileRoutes } from './routes/UserRoutes';
import { escapeXml } from '@duradav/webdav';

type AppRouter = HonoOpenAPIRouterType<{
  Bindings: Env;
  Variables: { AuthenticatedUserEmailAddress: string };
}>;

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

    // Minimal browser UI at / (no SPA build): lists visible volumes + links.
    app.get('/', async (c) => {
      let volumes: Array<{ owner: string; name: string; href: string }> = [];
      try {
        const scope = BaseRoute.getScope(c);
        let email: string | null = null;
        try {
          email = await scope
            .get(Tokens.AccessAuthService)
            .getAuthenticatedUserEmail(c.req.raw, c.executionCtx as never);
        } catch {
          email = null;
        }
        // PAT best-effort for browser with Authorization header
        if (!email) {
          const header = c.req.header('Authorization');
          if (header) {
            const token = header.startsWith('Bearer ')
              ? header.slice(7).trim()
              : header.startsWith('Basic ')
                ? (() => {
                    try {
                      const decoded = atob(header.slice(6).trim());
                      return decoded.slice(decoded.indexOf(':') + 1);
                    } catch {
                      return '';
                    }
                  })()
                : '';
            if (token) {
              try {
                const authenticated = await scope.get(Tokens.TokenService).authenticateWithPAT(token);
                email = authenticated.email;
              } catch {
                // ignore
              }
            }
          }
        }
        const dao = await scope.get(Tokens.DavVolumeDAO)();
        const rows = await dao.listVisibleForUser(email, 100).catch(() => []);
        volumes = rows.map((r) => ({ owner: r.owner, name: r.name, href: `/${r.owner}/${r.name}/` }));
      } catch {
        volumes = [];
      }
      const items =
        volumes.length === 0
          ? '<p>No volumes visible. Create one via <code>POST /user/volumes</code>.</p>'
          : volumes.map((v) => `<a href="${escapeXml(v.href)}">${escapeXml(v.owner)}/${escapeXml(v.name)}/</a><br>`).join('');
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>DuraDAV</title><style>*{box-sizing:border-box}body{padding:10px;font-family:system-ui,sans-serif}a{display:inline-block;min-width:240px;color:#000;text-decoration:none;padding:5px 10px;border-radius:5px}a:hover{background:#0ea5e9;color:#fff}</style></head><body><h1>DuraDAV</h1><div>${items}</div><p><a href="/health">health</a> · <a href="/docs">docs</a> · <a href="/user/me">me</a></p></body></html>`;
      return c.html(html);
    });

    app.use('*', scopeMiddleware);

    app.use('/user/*', MiddlewareHandlers.userAuthentication());

    registerVolumeRoutes(app);
    registerTokenRoutes(app);
    registerUserProfileRoutes(app);
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
