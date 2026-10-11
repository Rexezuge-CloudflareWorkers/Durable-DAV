import { createLogger } from '@rexezuge/runtime';

import { ExpiredCredentialPruningTask } from './ExpiredCredentialPruningTask';
import { ReplicationSyncTask } from './ReplicationSyncTask';

const logger = createLogger('CronTasks');

interface ScheduledTask {
  name: string;
  phase: 1 | 2;
  handle(
    event: { cron: string; scheduledTime: number; noRetry(): void },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void },
  ): Promise<void>;
}

interface TaskDefinition {
  name: string;
  phase: 1 | 2;
  make: () => ScheduledTask;
}

const CRON_TASK_FACTORIES: readonly TaskDefinition[] = [
  { name: 'ExpiredCredentialPruningTask', phase: 1, make: () => new ExpiredCredentialPruningTask() },
  // Phase 2: replication runs after the cheap hygiene pass, because a replication
  // that deletes on both sides should not be the first thing a tick spends its
  // budget on.
  { name: 'ReplicationSyncTask', phase: 2, make: () => new ReplicationSyncTask() },
];

function tasksForPhase(phase: 1 | 2): ScheduledTask[] {
  return CRON_TASK_FACTORIES.filter((d) => d.phase === phase).map((d) => d.make());
}

async function runScheduledTasks(env: Env, cron: string, scheduledTime: number): Promise<void> {
  logger.info(`Running scheduled tasks for ${cron} at ${scheduledTime}`);
  // The kit template owns the per-task try/catch (`AbstractScheduledTask.handle`
  // never rejects), so this loop only orders phases and contains the
  // already-impossible: a task whose `handle` itself throws synchronously
  // before reaching the template still must not take the other phase down.
  const event = { cron, scheduledTime, noRetry(): void {} };
  const ctx = { waitUntil(): void {}, passThroughOnException(): void {} };
  const phase1 = tasksForPhase(1);
  const phase2 = tasksForPhase(2);
  await Promise.all(phase1.map((t) => t.handle(event, env, ctx).catch((error: unknown) => logger.error(`Task ${t.name} failed`, error))));
  await Promise.all(phase2.map((t) => t.handle(event, env, ctx).catch((error: unknown) => logger.error(`Task ${t.name} failed`, error))));
}

export { CRON_TASK_FACTORIES, tasksForPhase, runScheduledTasks };
export { ExpiredCredentialPruningTask } from './ExpiredCredentialPruningTask';
export { ReplicationSyncTask } from './ReplicationSyncTask';
export type { ScheduledTask };
// The kit template the tasks extend. Re-exported so the phase table above and
// the task modules name one thing rather than two spellings of it.


export {type AbstractScheduledTask} from '@rexezuge/runtime';