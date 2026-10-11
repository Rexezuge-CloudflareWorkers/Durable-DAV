import { describe, expect, it } from 'vitest';
import { collectSlice } from '../apps/background/src/replication/collectSlice';
import type { LocalReplicaStub } from '../apps/background/src/replication/collectSlice';
import type { RemoteEntry, RemoteVolume } from '@durable-dav/backend-services/replication';

/**
 * The collector's defence against unusable listing paths.
 *
 * A listing entry no side can address (a trailing slash the transport failed to
 * strip, a doubled separator) must close the deletion gate *and* name itself.
 * Walking it instead asks the local volume about a path it must refuse, which
 * poisons the pass with no error attached — the shape that used to surface as
 * the generic synchronisation fallback.
 */

function entry(path: string, isCollection = false): RemoteEntry {
  return { path, isCollection, etag: '"v1"', mtime: 1000, size: 1, contentType: 'text/plain' };
}

function stub(lists: Record<string, RemoteEntry[]>): LocalReplicaStub & { listed: string[] } {
  const listed: string[] = [];
  return {
    listed,
    listReplicaChildren: async (path: string) => {
      listed.push(path);
      return { entries: lists[path] ?? [], complete: true };
    },
    readReplicaStream: async () => null,
    readReplicaBytes: async () => null,
    applyReplicaOperations: async () => ({ applied: 0, failed: 0, error: null }),
    loadReplicaStateRows: async () => [],
    forgetReplication: async () => {},
  };
}

function remote(lists: Record<string, RemoteEntry[]>): RemoteVolume {
  return {
    list: async (path: string) => ({ entries: lists[path] ?? [], complete: true }),
    stat: async () => null,
    readFile: async () => null,
    writeFile: async () => ({ etag: null }),
    makeCollection: async () => {},
    remove: async () => {},
    probe: async () => ({ davClasses: ['1'] }),
  };
}

function collect(localStub: LocalReplicaStub, remoteVolume: RemoteVolume) {
  return collectSlice({ localStub, remote: remoteVolume, replicationId: 'rep_1', maxCollections: 10, deadlineMs: Date.now() + 5000 });
}

describe('collectSlice — unusable listing paths', () => {
  it('drops a remote entry with a trailing slash and names it', async () => {
    const localStub = stub({});
    const slice = await collect(localStub, remote({ '': [entry('docs/', true)] }));
    expect(slice.complete).toBe(false);
    expect(slice.errors).toBe(0);
    expect(slice.firstError).toContain('docs/');
    expect(slice.remoteByPath.has('docs/')).toBe(false);
    // Never queued for a walk: the local volume would refuse it and report the
    // listing incomplete with nothing pointing at the cause.
    expect(localStub.listed).not.toContain('docs/');
  });

  it('drops a local entry with a doubled separator and names it', async () => {
    const localStub = stub({ '': [entry('a//b')] });
    const slice = await collect(localStub, remote({}));
    expect(slice.complete).toBe(false);
    expect(slice.firstError).toContain('a//b');
    expect(slice.localByPath.has('a//b')).toBe(false);
  });

  it('still walks every usable path around the dropped one', async () => {
    const localStub = stub({ '': [entry('ok.txt')] });
    const slice = await collect(localStub, remote({ '': [entry('docs/', true), entry('fine.txt')] }));
    expect(slice.localByPath.has('ok.txt')).toBe(true);
    expect(slice.remoteByPath.has('fine.txt')).toBe(true);
    expect(slice.remoteByPath.has('docs/')).toBe(false);
    expect(slice.complete).toBe(false);
  });
});
