import type { DavVolumeWorker } from '@durable-dav/background';
import { normalizeVolumeKey } from '@durable-dav/webdav';

/**
 * Resolve the Durable Object for a volume.
 *
 * Pure lookup by design. This used to also fire a fire-and-forget
 * `setVolumeKey` RPC, which meant an extra DO storage write (and a possible
 * isolate spin-up) on *every* WebDAV request, outside `ctx.waitUntil` so the
 * runtime could cancel it mid-flight — and the stored `volumeKey` was never
 * read back by anything. Callers that need the lifecycle write call
 * `stub.setVolumeKey(...)` explicitly (volume create).
 */
function getVolumeStub(env: Env, owner: string, volume: string): DurableObjectStub & DavVolumeWorker {
  const ns = (env as unknown as { DAV_VOLUME?: DurableObjectNamespace<DavVolumeWorker> }).DAV_VOLUME;
  if (!ns) throw new Error('DAV_VOLUME binding is not configured');
  return ns.getByName(normalizeVolumeKey(owner, volume)) as unknown as DurableObjectStub & DavVolumeWorker;
}

export { getVolumeStub };
