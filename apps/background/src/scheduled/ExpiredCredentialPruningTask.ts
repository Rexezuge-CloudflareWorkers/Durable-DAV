import { TimestampUtil } from '@durable-dav/shared/utils';
import { Tokens, createRequestScope } from '@durable-dav/backend-services/composition';
import { createLogger } from '@durable-dav/backend-runtime/logger';
import { BaseScheduledTask } from './IScheduledTask';

const logger = createLogger('CronTasks');

// Phase-1 fast task: drops expired bucket credential rows (`pruneExpired(now, 500)`).
// Kept on `BaseScheduledTask` (not `AbstractPruningTask`) — expiry pruning is
// driven by `expires_at < now`, not a retention-days cutoff.
class ExpiredCredentialPruningTask extends BaseScheduledTask {
  public readonly name = 'ExpiredCredentialPruningTask';
  public readonly phase: 1 | 2 = 1;

  protected async handleScheduledTask(env: Env): Promise<void> {
    const dao = await createRequestScope(env).get(Tokens.DavCredentialDAO)();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const pruned = await dao.pruneExpired(now, 500);
    if (pruned > 0) {
      logger.info(`Pruned ${pruned} expired bucket credentials`);
    }
  }
}

export { ExpiredCredentialPruningTask };
