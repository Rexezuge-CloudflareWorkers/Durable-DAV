import type { PlanBase } from '@durable-dav/backend-services/replication';
import type { ReplicaStateRow } from '@durable-dav/dav-store';
import type { LocalReplicaStub } from './replicaTypes';

/**
 * The recorded base, restricted to the subtree this slice actually opened.
 *
 * ## The rule
 *
 * A base row is loaded only when the path's **parent collection was listed in
 * this slice**. That is what keeps the recorded state and the slice's view in
 * step: a path whose parent was not listed is not in this slice's view at all,
 * so the planner cannot see it, and a base row for a path the planner cannot see
 * would be read as a path that has vanished from both sides — which is a
 * deletion, and the thing the gate exists to prevent.
 *
 * The rule used to accept a base row whose own collection had been visited as
 * well, which was equivalent for a sweep that started at the root and wrong for
 * one that resumed: the resumed slice loaded the base of a collection covered by
 * an *earlier* slice while holding no view of its contents.
 */
async function baseForVisited(localStub: LocalReplicaStub, replicationId: string, visited: ReadonlySet<string>): Promise<PlanBase[]> {
  const base: PlanBase[] = [];
  const recorded = await localStub.loadReplicaStateRows(replicationId);
  for (const row of recorded) {
    // The root has no parent and no base of its own: it is the collection every
    // path hangs from, not a path.
    if (row.path === '') continue;
    if (visited.has(parentOf(row.path))) base.push(toPlanBase(row));
  }
  return base;
}

/**
 * The recorded state of one path, as the planner sees it.
 */
function toPlanBase(row: ReplicaStateRow): PlanBase {
  return {
    path: row.path,
    isCollection: row.isCollection,
    localEtag: row.localEtag,
    localMtime: row.localMtime,
    localSize: row.localSize,
    remoteEtag: row.remoteEtag,
    remoteMtime: row.remoteMtime,
    remoteSize: row.remoteSize,
    contentType: row.contentType,
  };
}

/**
 * The collection that holds a path.
 *
 * The root's own parent is the root, so a top-level path's parent is `''` — the
 * root, which is a collection like any other and is listed like any other.
 */
function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export { baseForVisited, toPlanBase, parentOf };
