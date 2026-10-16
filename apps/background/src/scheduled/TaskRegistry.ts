import { createLogger, TaskRegistry } from '@rexezuge/runtime';
import type { AbstractScheduledTask } from '@rexezuge/runtime';

import { ExpiredCredentialPruningTask } from './ExpiredCredentialPruningTask';
import { ReplicationSyncTask } from './ReplicationSyncTask';

const logger = createLogger('CronTasks');

/**
 * The tick's phase table.
 *
 * The kit's `TaskRegistry` owns ordering, so this file declares only *which*
 * tasks exist and in which phase. It replaces a local `{ name, phase, make }`
 * array plus a `tasksForPhase` that re-derived the same grouping: phase lives
 * in the registration, not on each task, so there is no field to drift from it.
 *
 * Phase 1 is the cheap hygiene pass; replication is phase 2 because a
 * replication that deletes on both sides should not be the first thing a tick
 * spends its budget on. Both tasks are stateless, so one instance each is
 * registered once and reused by every tick.
 */
const registry = new TaskRegistry().register(1, new ExpiredCredentialPruningTask()).register(2, new ReplicationSyncTask());

/**
 * A registered task, with the label the failure log names.
 *
 * The intersection is asserted here rather than at the `.catch`: `TaskRegistry`
 * is typed on the kit's template, which carries no `name`, and
 * `constructor.name` cannot stand in for one — the deployed build minifies
 * (`"minify": true` in the wrangler template), which renames the class, so the
 * log would name a single letter.
 */
type CronTask = AbstractScheduledTask & { readonly name: string };

function tasksForPhase(phase: number): readonly CronTask[] {
  return registry.tasksForPhase(phase) as readonly CronTask[];
}

/**
 * Run one tick: phases in order, tasks within a phase concurrently.
 *
 * The kit template's `handle` catches, logs and **re-throws** — its
 * `swallowErrors()` defaults to `false` — so the per-task `.catch` below is the
 * containment layer, not a formality: one task's failure must not stop the rest
 * of its phase or the following one. A cron tick has no retry to hand the
 * rejection to, and this line is where the error value lands.
 */
async function runScheduledTasks(env: Env, cron: string, scheduledTime: number): Promise<void> {
  logger.info(`Running scheduled tasks for ${cron} at ${scheduledTime}`);
  const event = { cron, scheduledTime, noRetry(): void {} };
  const ctx = { waitUntil(): void {}, passThroughOnException(): void {} };
  for (const phase of registry.phases()) {
    await Promise.all(
      tasksForPhase(phase).map((task) =>
        task.handle(event, env, ctx).catch((error: unknown) => logger.error(`Task ${task.name} failed`, error)),
      ),
    );
  }
}

export { registry, runScheduledTasks, tasksForPhase };
export { ExpiredCredentialPruningTask } from './ExpiredCredentialPruningTask';
export { ReplicationSyncTask } from './ReplicationSyncTask';
