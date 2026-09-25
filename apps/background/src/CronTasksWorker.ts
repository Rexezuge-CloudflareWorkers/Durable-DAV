import { DurableObject } from 'cloudflare:workers';
import { createLogger } from '@durable-dav/backend-runtime/logger';
import { runScheduledTasks } from './scheduled/TaskRegistry';

const logger = createLogger('CronTasksWorker');

class CronTasksWorker extends DurableObject<Env> {
  // Per-schedule single-flight: the 10-min and 4-hour ticks must not block
  // each other (a long search backfill previously returned 202 for the fast
  // tick and dropped token pruning). Same-schedule overlap still 202s.
  private readonly runs = new Map<string, Promise<void>>();

  public override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/run' || request.method !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as { cron?: string; scheduledTime?: number };
    const key = body.cron ?? '';
    if (this.runs.has(key)) {
      return new Response('Already running', { status: 202 });
    }
    const run = runScheduledTasks(this.env, body.cron ?? '', body.scheduledTime ?? Date.now())
      .catch((error: unknown) => {
        logger.error('Cron run failed', error);
      })
      .finally(() => {
        this.runs.delete(key);
      });
    this.runs.set(key, run);
    // Single-flight without blocking: return 202 immediately and let the DO
    // keep running via waitUntil. Awaiting here would serialize cron ticks
    // behind the full phase1+phase2 run and risk DO fetch wall-time timeouts.
    const waitUntil = (this.ctx as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil?.bind(this.ctx);
    if (typeof waitUntil === 'function') {
      waitUntil(run);
    }
    return new Response('Started', { status: 202 });
  }
}

export { CronTasksWorker };
export type { Env };
