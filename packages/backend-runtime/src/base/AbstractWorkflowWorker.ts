// Minimal Workflow base so backend-runtime typechecks without
// `cloudflare:workers`. Edge-Git v1 has no workflows; this exists for
// structural parity with other workers in the family.
interface WorkflowEventLike<T = unknown> {
  payload: T;
}

interface WorkflowStepLike {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

abstract class AbstractWorkflowWorker<TPayload = unknown, TResult = unknown> {
  public async run(event: Readonly<WorkflowEventLike<TPayload>>, step: WorkflowStepLike): Promise<TResult> {
    try {
      return await this.onWorkflow(event, step);
    } catch (err: unknown) {
      console.error('Unhandled error in workflow run():', err);
      throw err;
    }
  }

  protected abstract onWorkflow(event: Readonly<WorkflowEventLike<TPayload>>, step: WorkflowStepLike): Promise<TResult>;
}

export { AbstractWorkflowWorker };
export type { WorkflowEventLike, WorkflowStepLike };
