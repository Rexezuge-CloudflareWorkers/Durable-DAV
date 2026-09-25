import { TimestampUtil } from '@durable-dav/shared/utils';
import { createLogger } from '@durable-dav/backend-runtime/logger';

const logger = createLogger('CronTasks');

interface ScheduledTask {
  name: string;
  phase: 1 | 2;
  run: (env: Env) => Promise<void>;
}

// Template Method: `run` is the invariant entrypoint (logging + delegation),
// subclasses implement `handleScheduledTask` with the phase-specific work.
abstract class BaseScheduledTask implements ScheduledTask {
  public abstract readonly name: string;
  public abstract readonly phase: 1 | 2;

  public run(env: Env): Promise<void> {
    return this.handle(env);
  }

  public async handle(env: Env): Promise<void> {
    logger.info(`Running scheduled task ${this.name}`);
    await this.handleScheduledTask(env);
  }

  protected abstract handleScheduledTask(env: Env): Promise<void>;
}

// Template Method for retention pruning (Otter `AbstractPruningTask` pattern):
// subclasses supply the retention window + the batched prune call; the base
// owns cutoff arithmetic, failure swallowing (a prune miss retries next tick),
// and count logging so the three prune tasks stop duplicating the shape.
abstract class AbstractPruningTask extends BaseScheduledTask {
  protected abstract getRetentionDays(env: Env): number;

  protected abstract pruneBatch(env: Env, cutoff: number, batchSize: number): Promise<number>;

  protected abstract getPrunedNoun(): string;

  protected getBatchSize(): number {
    return 500;
  }

  protected async handleScheduledTask(env: Env): Promise<void> {
    const cutoff = TimestampUtil.getCurrentUnixTimestampInSeconds() - this.getRetentionDays(env) * 86_400;
    const pruned = await this.pruneBatch(env, cutoff, this.getBatchSize()).catch(() => 0);
    if (pruned > 0) {
      logger.info(`Pruned ${pruned} ${this.getPrunedNoun()}`);
    }
  }
}

export { BaseScheduledTask, AbstractPruningTask };
export type { ScheduledTask };
