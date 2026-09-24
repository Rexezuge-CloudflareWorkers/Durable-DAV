import { createLogger } from '@duradav/backend-runtime/logger';
import type { ScheduledTask } from './IScheduledTask';
import { ExpiredTokenPruningTask } from './ExpiredTokenPruningTask';

const logger = createLogger('CronTasks');

interface TaskDefinition {
  name: string;
  phase: 1 | 2;
  make: () => ScheduledTask;
}

const CRON_TASK_FACTORIES: readonly TaskDefinition[] = [
  { name: 'ExpiredTokenPruningTask', phase: 1, make: () => new ExpiredTokenPruningTask() },
];

const CRON_TASK_DEFINITIONS: ScheduledTask[] = CRON_TASK_FACTORIES.map((d) => d.make());

function tasksForPhase(phase: 1 | 2): ScheduledTask[] {
  return CRON_TASK_FACTORIES.filter((d) => d.phase === phase).map((d) => d.make());
}

async function runScheduledTasks(env: Env, cron: string, scheduledTime: number): Promise<void> {
  logger.info(`Running scheduled tasks for ${cron} at ${scheduledTime}`);
  const phase1 = tasksForPhase(1);
  const phase2 = tasksForPhase(2);
  await Promise.all(phase1.map((t) => t.run(env).catch((error: unknown) => logger.error(`Task ${t.name} failed`, error))));
  await Promise.all(phase2.map((t) => t.run(env).catch((error: unknown) => logger.error(`Task ${t.name} failed`, error))));
}

export { CRON_TASK_DEFINITIONS, CRON_TASK_FACTORIES, tasksForPhase, runScheduledTasks };
export { ExpiredTokenPruningTask } from './ExpiredTokenPruningTask';
export type { ScheduledTask } from './IScheduledTask';
