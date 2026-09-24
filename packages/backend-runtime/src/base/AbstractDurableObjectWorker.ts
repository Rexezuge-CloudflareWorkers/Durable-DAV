// Minimal Durable Object base so backend-runtime typechecks without
// `cloudflare:workers`. Real DO classes (apps/background) extend the real
// `DurableObject` from `cloudflare:workers`; this helper is for plain
// request dispatch in tests and non-DO contexts.
interface DurableObjectStateLike {
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  storage?: unknown;
  id?: unknown;
}

abstract class AbstractDurableObjectWorker {
  constructor(
    protected readonly ctx: DurableObjectStateLike,
    protected readonly env: Env,
  ) {}

  public async fetch(request: Request): Promise<Response> {
    try {
      return await this.onRequest(request);
    } catch (err: unknown) {
      console.error('Unhandled error in durable object fetch():', err);
      return Response.json({ error: 'Internal Error' }, { status: 500 });
    }
  }

  protected createExecutionContext(): { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void } {
    return {
      waitUntil: (promise: Promise<unknown>): void => this.ctx.waitUntil(promise),
      passThroughOnException: (): void => undefined,
    };
  }

  protected abstract onRequest(request: Request): Promise<Response>;
}

export { AbstractDurableObjectWorker };
export type { DurableObjectStateLike };
