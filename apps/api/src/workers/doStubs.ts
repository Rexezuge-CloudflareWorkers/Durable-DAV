import type { DavVolumeWorker } from '@durable-dav/background';
import { normalizeVolumeKey } from '@durable-dav/webdav';

function getVolumeStub(env: Env, owner: string, volume: string): DurableObjectStub & DavVolumeWorker {
  const ns = (env as unknown as { DAV_VOLUME?: DurableObjectNamespace<DavVolumeWorker> }).DAV_VOLUME;
  if (!ns) throw new Error('DAV_VOLUME binding is not configured');
  const key = normalizeVolumeKey(owner, volume);
  const stub = ns.getByName(key) as unknown as DurableObjectStub & DavVolumeWorker;
  void (stub.setVolumeKey(`${owner}/${volume}`) as Promise<unknown>).catch(() => undefined);
  return stub;
}

export { getVolumeStub };
