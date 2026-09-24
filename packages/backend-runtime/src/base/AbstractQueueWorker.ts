import type { WorkerExecutionContext } from './AbstractEntrypointWorker';

interface WorkerMessageBatch<T = unknown> {
  messages: T[];
}

abstract class AbstractQueueWorker<T = unknown> {
  public async queue(batch: WorkerMessageBatch<T>, env: Env, ctx: WorkerExecutionContext): Promise<void> {
    try {
      await this.onQueue(batch, env, ctx);
    } catch (err: unknown) {
      console.error('Unhandled error in queue():', err);
      throw err;
    }
  }

  protected abstract onQueue(batch: WorkerMessageBatch<T>, env: Env, ctx: WorkerExecutionContext): Promise<void>;
}

export { AbstractQueueWorker };
export type { WorkerMessageBatch };
