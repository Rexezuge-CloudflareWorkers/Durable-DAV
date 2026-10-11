import { TimestampUtil } from '@rexezuge/shared';
import { Tokens, createRequestScope } from '@durable-dav/backend-services/composition';
import { AbstractScheduledTask, createLogger } from '@rexezuge/runtime';
import type { ScheduledTaskEnv } from '@rexezuge/runtime';

const logger = createLogger('CronTasks');

// Phase-1 fast task: drops expired bucket credential rows (`pruneExpired(now, 500)`).
// Kept off the run recorder (`getTaskType` stays null) — expiry pruning is
// driven by `expires_at < now`, not a retention-days cutoff, and this repo
// keeps no task-runs table. Runs are observed through the prune count log.
class ExpiredCredentialPruningTask extends AbstractScheduledTask {
  public readonly name = 'ExpiredCredentialPruningTask';
  public readonly phase: 1 | 2 = 1;

  protected getTaskType(): string | null {
    return null;
  }

  protected async handleScheduledTask(
    _event: { cron: string; scheduledTime: number },
    env: Env & ScheduledTaskEnv,
    _ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    const dao = await createRequestScope(env).get(Tokens.DavCredentialDAO)();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const pruned = await dao.pruneExpired(now, 500);
    if (pruned > 0) {
      logger.info(`Pruned ${pruned} expired bucket credentials`);
    }
  }
}

export { ExpiredCredentialPruningTask };
