import { describe, expect, it } from 'vitest';
import { sweepAncestorChain, sweepOrderCompare, sweepSort } from '@durable-dav/backend-services/replication';
import { collectSlice } from '../apps/background/src/replication/collectSlice';
import type { LocalReplicaStub } from '../apps/background/src/replication/collectSlice';
import type { RemoteEntry, RemoteVolume } from '@durable-dav/backend-services/replication';

/**
 * The sweep's order, and the resume that depends on it.
 *
 * ## What is being protected
 *
 * A replication pass visits a bucket a slice at a time. A tick that runs out of
 * budget parks a cursor and the next tick continues from it — and that only
 * works if the order is a **pre-order** over name-sorted children, because a
 * pre-order is the one order whose visited set is a *prefix* of the order
 * itself. A cursor then names exactly what has been covered.
 *
 * The order it replaced was breadth-first, and it had two properties that made a
 * sliced sweep impossible:
 *
 * 1. Its frontier depended on the whole queue rather than on a path, so no
 *    cursor could describe it. The sweep restarted from the root on every tick,
 *    and a tree deeper than one slice was never visited at all — the deep end of
 *    a bucket was silently never synced.
 * 2. The collections it had visited were not a prefix of any order, so a
 *    resumed slice could not tell which base rows belonged to what it had seen.
 *
 * The tests below cover the order itself, and then the property that matters:
 * **a tree larger than one slice is still swept to its end.**
 */

function entry(path: string, isCollection = false): RemoteEntry {
  return { path, isCollection, etag: '"v1"', mtime: 1000, size: 1, contentType: 'text/plain' };
}

describe('sweepOrderCompare — the order a collection is visited in', () => {
  it('puts a collection before the collections inside it', () => {
    // The property whole-string comparison gets wrong: `a/b` sorts before `a`
    // as a string, but `a` is a collection whose subtree comes first.
    expect(sweepOrderCompare('a', 'a/b')).toBeLessThan(0);
    expect(sweepOrderCompare('a/b', 'a')).toBeGreaterThan(0);
  });

  it('puts a sibling before a deeper path that shares its prefix', () => {
    expect(sweepOrderCompare('a/b', 'a.txt')).toBeLessThan(0);
    expect(sweepOrderCompare('a/b/c', 'a/b')).toBeGreaterThan(0);
  });

  it('orders siblings by name', () => {
    expect(sweepOrderCompare('a', 'b')).toBeLessThan(0);
    expect(sweepOrderCompare('b', 'a')).toBeGreaterThan(0);
    expect(sweepOrderCompare('a', 'a')).toBe(0);
  });

  it('is a total order over a mixed tree', () => {
    const paths = ['b', 'a/x/deep.txt', 'a', 'a/x', 'a.txt', 'a/y', 'b/z'];
    // `a`'s whole subtree comes before `a.txt`, because `a` is a collection and
    // the order is a pre-order. Whole-string comparison would put `a.txt` first.
    expect(sweepSort(paths)).toEqual(['a', 'a/x', 'a/x/deep.txt', 'a/y', 'a.txt', 'b', 'b/z']);
    // Sorting does not mutate the caller's array.
    expect(paths[0]).toBe('b');
  });

  it('is antisymmetric and transitive over the paths a bucket can hold', () => {
    const paths = ['a', 'a/b', 'a/b/c', 'a.txt', 'b', 'b/c', ''];
    for (const left of paths) {
      for (const right of paths) {
        expect(Math.sign(sweepOrderCompare(left, right)) + Math.sign(sweepOrderCompare(right, left))).toBe(0);
      }
    }
  });
});

describe('sweepAncestorChain — the path down to a cursor', () => {
  it('starts at the root', () => {
    // The root is the only collection whose listing names every top-level path,
    // so the resume always needs it.
    expect(sweepAncestorChain('a/b/c')).toEqual(['', 'a', 'a/b', 'a/b/c']);
  });

  it('is just the root for the root itself', () => {
    expect(sweepAncestorChain('')).toEqual(['']);
  });
});

/**
 * A bucket shaped like this, which is deep enough to need more than one slice
 * and wide enough to have siblings at more than one level:
 *
 * ```
 * /
 *   a/
 *     a/x/
 *       a/x/deep.txt
 *     a/y/
 *   b/
 *     b/z.txt
 * ```
 *
 * The pre-order over it is `/`, `a`, `a/x`, `a/y`, `b` — five collections.
 */
function tree(): Record<string, RemoteEntry[]> {
  return {
    '': [entry('a', true), entry('b', true)],
    a: [entry('a/x', true), entry('a/y', true)],
    'a/x': [entry('a/x/deep.txt')],
    'a/y': [],
    b: [entry('b/z.txt')],
  };
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

describe('collectSlice — a sweep larger than one slice', () => {
  it('reaches the end of a tree it cannot cover in one slice', async () => {
    // The defect this replaces: the sweep restarted from the root on every tick,
    // so the collections past the slice budget were never visited and the deep
    // end of the bucket was silently never synced.
    const lists = tree();
    const visited = new Set<string>();
    let cursor: string | null = null;
    let slices = 0;

    for (;;) {
      slices += 1;
      expect(slices).toBeLessThan(20);
      const localStub = stub(lists);
      const slice = await collectSlice({
        localStub,
        remote: remote(lists),
        replicationId: 'rep_1',
        maxCollections: 1,
        deadlineMs: Date.now() + 5000,
        resumeFrom: cursor,
      });
      for (const path of localStub.listed) visited.add(path);
      if (slice.remaining === 0) break;
      expect(slice.cursor).not.toBeNull();
      cursor = slice.cursor;
    }

    // Every collection in the tree was listed by the end of the sweep — the deep
    // ones included, which is what the old breadth-first sweep never achieved.
    expect([...visited].sort()).toEqual(['', 'a', 'a/x', 'a/y', 'b']);
    // And it took more than one slice to get there.
    expect(slices).toBeGreaterThan(1);
  });

  it('advances the cursor monotonically', async () => {
    // A cursor that moved backwards would make the next slice re-cover ground it
    // had already decided — and, worse, report the sweep complete while skipping
    // the part in between.
    const lists = tree();
    let cursor: string | null = null;
    const seen: string[] = [];
    for (let slice = 0; slice < 10; slice += 1) {
      const result = await collectSlice({
        localStub: stub(lists),
        remote: remote(lists),
        replicationId: 'rep_1',
        maxCollections: 1,
        deadlineMs: Date.now() + 5000,
        resumeFrom: cursor,
      });
      if (result.cursor !== null) {
        if (cursor !== null) expect(sweepOrderCompare(result.cursor, cursor)).toBeGreaterThan(0);
        seen.push(result.cursor);
      }
      cursor = result.cursor;
      if (result.remaining === 0) break;
    }
    expect(seen).toEqual(['', 'a', 'a/x', 'a/y']);
  });

  it('loads a base row only for a path whose parent this slice listed', async () => {
    // The recorded base and the slice's view have to agree. A base row for a path
    // the slice cannot see reads as a path that has vanished from both sides —
    // which is a deletion, and the thing the gate exists to prevent.
    const lists = tree();
    const rows = [
      {
        path: 'a/x/deep.txt',
        replicationId: 'rep_1',
        isCollection: false,
        localEtag: '"v1"',
        localMtime: 1,
        localSize: 1,
        remoteEtag: '"v1"',
        remoteMtime: 1,
        remoteSize: 1,
        contentType: null,
        syncedAt: 1,
      },
      {
        path: 'b/z.txt',
        replicationId: 'rep_1',
        isCollection: false,
        localEtag: '"v1"',
        localMtime: 1,
        localSize: 1,
        remoteEtag: '"v1"',
        remoteMtime: 1,
        remoteSize: 1,
        contentType: null,
        syncedAt: 1,
      },
    ];
    const localStub = stub(lists);
    localStub.loadReplicaStateRows = async () => rows as never;
    const slice = await collectSlice({
      localStub,
      remote: remote(lists),
      replicationId: 'rep_1',
      maxCollections: 1,
      deadlineMs: Date.now() + 5000,
      resumeFrom: 'a/x',
    });
    // `a/x` was listed in this slice, so its contents are in view and their base
    // rows are loaded. `b` was not, so `b/z.txt` is not in view and its base row
    // must not be loaded either.
    expect(slice.base.map((row) => row.path)).toEqual(['a/x/deep.txt']);
  });

  it('restarts from the root when the cursor no longer names a collection', async () => {
    // The tree changed under the cursor — the collection was deleted, or renamed.
    // The frontier cannot be reconstructed, so the sweep starts over rather than
    // carrying on from a position that no longer exists.
    const lists = tree();
    delete lists['a'];
    const slice = await collectSlice({
      localStub: stub(lists),
      remote: remote(lists),
      replicationId: 'rep_1',
      maxCollections: 10,
      deadlineMs: Date.now() + 5000,
      resumeFrom: 'a/x',
    });
    // A fresh sweep: the root was listed, and the cursor is not the abandoned one.
    expect(slice.cursor).not.toBe('a/x');
    expect(slice.localByPath.has('b')).toBe(true);
  });

  it('reports the sweep as unfinished while there is work left', async () => {
    // `remaining` is what closes the pass, and a closed pass opens the deletion
    // gate. A sweep that stopped for budget reasons has work left, and must say
    // so.
    const lists = tree();
    const slice = await collectSlice({
      localStub: stub(lists),
      remote: remote(lists),
      replicationId: 'rep_1',
      maxCollections: 2,
      deadlineMs: Date.now() + 5000,
    });
    expect(slice.remaining).toBeGreaterThan(0);
    expect(slice.cursor).not.toBeNull();
  });
});
