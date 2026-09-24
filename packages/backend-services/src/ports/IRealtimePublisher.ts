/**
 * Outbound realtime transport port (Ports pattern).
 *
 * `backend-services` owns the realtime fan-out *decisions* (channel
 * mapping, recipient hashing, disabled-guards) but must not resolve DO
 * stubs — `getRealtimeStub` lives in `apps/api` (layer rule). Emitters
 * (thin, in `apps/api`) supply the transport; subscribers invoke it.
 * Tests inject fakes without workerd.
 */
interface IRealtimePublisher {
  publishToShard(shard: string, message: Record<string, unknown>): Promise<void>;
}

export type { IRealtimePublisher };
