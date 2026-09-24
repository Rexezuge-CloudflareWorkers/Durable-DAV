import { TimestampUtil } from '@duradav/shared/utils';
import { Tokens, createRequestScope } from '@duradav/backend-services/composition';
import { createLogger } from '@duradav/backend-runtime/logger';
import { BaseScheduledTask } from './IScheduledTask';

const logger = createLogger('CronTasks');

// Phase-1 fast task: drops expired PAT rows (`pruneExpired(now, 500)`).
// Kept on `BaseScheduledTask` (not `AbstractPruningTask`) — expiry pruning is
// driven by `expires_at < now`, not a retention-days cutoff.
class ExpiredTokenPruningTask extends BaseScheduledTask {
  public readonly name = 'ExpiredTokenPruningTask';
  public readonly phase: 1 | 2 = 1;

  protected async handleScheduledTask(env: Env): Promise<void> {
    const dao = await createRequestScope(env).get(Tokens.UserAccessTokenDAO)();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const pruned = await dao.pruneExpired(now, 500);
    if (pruned > 0) {
      logger.info(`Pruned ${pruned} expired access tokens`);
    }
  }
}

export { ExpiredTokenPruningTask };
