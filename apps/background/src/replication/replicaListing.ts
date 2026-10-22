import { createLogger } from '@rexezuge/runtime';
import type { RemoteEntry, RemoteListing, RemoteVolume } from '@durable-dav/backend-services/replication';
import { sweepSort } from '@durable-dav/backend-services/replication';
import { isValidInnerPath } from '../dav/DavContext';
import type { LocalReplicaStub, ReplicaListing } from './replicaTypes';

const logger = createLogger('Replication');

/**
 * One collection, seen from both sides.
 *
 * The two sides are listed separately and kept apart, because the planner
 * compares them: a path that is on one side only is an absence, and an absence
 * is the thing the deletion gate exists to be careful about.
 */
export type CollectionListing = {
  /**
   * The collection-children of this collection, from both sides, in sweep order.
   */
  children: string[];
  localEntries: RemoteEntry[];
  remoteEntries: RemoteEntry[];
  /**
   * Whether both sides covered the collection completely.
   */
  complete: boolean;
  errors: number;
  firstError: string | null;
};

/**
 * List one collection on both sides.
 *
 * ## The failures
 *
 * A listing that *fails* and a listing that reports itself *incomplete* are the
 * same kind of event: the slice cannot tell what is not there, and an absence
 * it cannot vouch for must not be acted on. Both clear `complete`, which is
 * what closes the deletion gate for the pass, and both leave an error the run
 * record can show.
 *
 * A listing that fails is emphatically **not** treated as an empty collection:
 * "this directory has no children" and "we could not read this directory" have
 * opposite consequences, and only one of them is a reason to delete things.
 *
 * ## The children
 *
 * The children are the **union** of both sides'. A collection that exists on
 * only one of them still has to be visited: it holds files the planner has to
 * decide about, and it may hold files the other side has to receive.
 *
 * A path that is *this* collection is dropped: some transports answer a listing
 * with the collection itself among its children, and descending into it would
 * walk the same collection forever. A path that has already been visited is
 * dropped for the same reason — the walk visits each collection once.
 */
async function listCollection(options: {
  path: string;
  localStub: LocalReplicaStub;
  remote: RemoteVolume;
  /**
   * The collections the walk has already visited.
   */
  visited: ReadonlySet<string>;
}): Promise<CollectionListing> {
  const { path, localStub, remote, visited } = options;
  const localEntries: RemoteEntry[] = [];
  const remoteEntries: RemoteEntry[] = [];
  const children = new Set<string>();
  let complete = true;
  let errors = 0;
  let firstError: string | null = null;

  const noteChild = (entry: RemoteEntry): void => {
    if (!entry.isCollection || entry.path === path || visited.has(entry.path)) return;
    children.add(entry.path);
  };

  const localListing = await localStub.listReplicaChildren(path).catch((error: unknown) => {
    errors += 1;
    if (firstError === null) firstError = `listing ${path} locally: ${describe(error)}`;
    logger.warn(`listing ${path} locally failed`, error);
    return { entries: [] as RemoteEntry[], complete: false } satisfies ReplicaListing;
  });
  // Symmetric with the remote check below, and load-bearing for the same reason.
  // A partial local listing means paths in this collection are missing from the
  // local view, and the planner will read each of those as "not here" and queue
  // a pull — which can overwrite a good local copy with a stale remote one.
  if (!localListing.complete) complete = false;
  for (const entry of localListing.entries) {
    // An entry no side can address must not enter the plan. Queueing it would
    // walk a path the local volume answers `complete: false` to, poisoning the
    // pass with no named error — the shape that used to surface as the generic
    // "could not be synchronised" fallback. It is dropped and the listing is
    // marked incomplete instead, so the gate closes *and* the run record says why.
    if (!isValidInnerPath(entry.path)) {
      complete = false;
      if (firstError === null) firstError = `listing ${path} locally: entry ${JSON.stringify(entry.path)} is not a usable path`;
      logger.warn(`listing ${path} locally returned an unusable path`, entry.path);
      continue;
    }
    localEntries.push(entry);
    noteChild(entry);
  }

  let listing: RemoteListing;
  try {
    listing = await remote.list(path);
  } catch (error) {
    errors += 1;
    if (firstError === null) firstError = `listing ${path} remotely: ${describe(error)}`;
    logger.warn(`listing ${path} on the remote failed`, error);
    return { children: sweepSort([...children]), localEntries, remoteEntries, complete, errors, firstError };
  }
  // A remote that reports an incomplete listing has just told us its absences
  // are meaningless, and that is precisely what the deletion gate acts on.
  //
  // Sticky, not per-collection: one incomplete listing anywhere in the walk
  // makes *every* absence in this slice untrustworthy, because the planner is
  // handed one combined view of both sides and cannot tell which collection an
  // individual missing path belonged to.
  if (!listing.complete) complete = false;
  for (const entry of listing.entries) {
    // Symmetric with the local check above: a remote href that does not map to
    // an addressable path (a trailing slash the transport failed to strip, a
    // doubled separator) would otherwise be walked into a local path that can
    // never complete it.
    if (!isValidInnerPath(entry.path)) {
      complete = false;
      if (firstError === null) firstError = `listing ${path} remotely: entry ${JSON.stringify(entry.path)} is not a usable path`;
      logger.warn(`listing ${path} on the remote returned an unusable path`, entry.path);
      continue;
    }
    remoteEntries.push(entry);
    noteChild(entry);
  }
  return { children: sweepSort([...children]), localEntries, remoteEntries, complete, errors, firstError };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { listCollection, describe };
