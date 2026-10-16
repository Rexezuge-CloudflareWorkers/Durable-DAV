/**
 * Stand-in for the `cloudflare:workers` module, which has no Node equivalent.
 *
 * Provenance: converged from the eight copies at `test/mocks/cloudflare-workers.ts`
 * (AWS-AccessBridge, CalDAV-Bridge, ChordDHT-Tracker, Durable-DAV, Edge-Git,
 * Edge-Sonic, Mail-Meow, Mail-Otter). All eight are the same twenty lines; the
 * union is three base classes and the union exists because each repo discovered a
 * missing one the hard way.
 *
 * ### What each source contributes
 *
 * - **DurableObject** — every copy. Stores `ctx` and `env` so a real DO class can
 *   be constructed and its lifecycle RPCs driven directly, without Miniflare.
 * - **`RpcTarget`** — Durable-DAV's, and the reason is load-bearing rather than
 *   tidy: `dofs`' `Fs` class `extends RpcTarget`, so the module fails to evaluate
 *   with *"Class extends value undefined"* when the base is missing. That is a
 *   module-load error, not a test failure, so it surfaces as an unimportable
 *   `dav-store` barrel and no unit test can reach `DavRepository`. Deliberately
 *   empty: on the platform it marks which methods are callable across an RPC
 *   boundary, and nothing in a Node suite calls those through RPC. An empty base
 *   keeps the fake honest instead of pretending to implement dispatch.
 * - **`WorkflowEntrypoint`** — Edge-Git, Edge-Sonic, Mail-Meow, Mail-Otter. A
 *   Workflow class extends it, so the mock must provide it or the module fails the
 *   same way — a **startup** error, which therefore takes down every suite that
 *   reaches `apps/background` for an unrelated reason. Edge-Sonic's is the shape
 *   kept: it stores `ctx` as well as `env`, because the failure policy under test
 *   in `runWorkflow` lives in a plain function precisely so it can be exercised
 *   without workerd, and that policy reads the execution context.
 *
 * ### Why the ambient types are declared here rather than imported
 *
 * The source repos name `DurableObjectState`, `ExecutionContext` and `Env`
 * unqualified, which resolves only because `worker-configuration.d.ts` and
 * `@cloudflare/workers-types` are ambient inside a Wrangler project. This copy is
 * imported by the kit's own typecheck, where neither exists, so the two state
 * shapes are declared locally and `TEnv` defaults to `unknown` instead of `Env`
 * (Edge-Sonic's form). A local declaration shadows the ambient one inside this
 * file only, so a consumer's copy typechecks against their generated types
 * exactly as the original did.
 *
 * ### Usage in a consumer
 *
 * Copy this file to `<repo>/test/mocks/cloudflare-workers.ts` and alias the
 * specifier in the Vitest config — `defineUnitVitestConfig()` already does:
 *
 * ```jsonc
 * // wrangler.jsonc / vitest alias
 * "cloudflare:workers": "test/mocks/cloudflare-workers.ts"
 * ```
 *
 * Only what a test actually imports is exported. A symbol here that nothing
 * imports is not a safety net; it is a claim that something depends on it.
 */

/**
 * The subset of `DurableObjectState` a Node test reaches.
 *
 * Declared structurally rather than imported: `id`, `storage` and `waitUntil` are
 * the three a hand-driven lifecycle touches, and nothing here needs the rest.
 */
export interface DurableObjectState {
  readonly id: { toString(): string; readonly name?: string };
}

/**
 * The subset of `ExecutionContext` a Node test reaches.
 *
 * `waitUntil` is present because a Workflow's `run()` is driven through it, and
 * `passThroughOnException` is absent on purpose — nothing in a Node suite wires a
 * request through it.
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * The base class every Durable Object extends.
 *
 * `protected`, exactly as on the platform: a DO subclass reads `this.env` and
 * `this.ctx`, and nothing outside it may.
 */
class DurableObject<TEnv = unknown> {
  protected ctx: DurableObjectState;
  protected env: TEnv;

  constructor(ctx: DurableObjectState, env: TEnv) {
    this.ctx = ctx;
    this.env = env;
  }
}

/**
 * The base class `dofs`' `Fs` extends. See the header: an empty body is the
 * whole point, and a missing class is a module-load failure.
 */
class RpcTarget {}

/**
 * The base class every Workflow extends.
 *
 * `ctx` is `ExecutionContext` rather than `unknown` (Mail-Meow/Mail-Otter's
 * form) because a Workflow's step code reads it; `void ctx` to silence the unused
 * warning would be a lie about which of the two a subclass uses.
 */
class WorkflowEntrypoint<TEnv = unknown> {
  protected ctx: ExecutionContext;
  protected env: TEnv;

  constructor(ctx: ExecutionContext, env: TEnv) {
    this.ctx = ctx;
    this.env = env;
  }
}

export { DurableObject, RpcTarget, WorkflowEntrypoint };
