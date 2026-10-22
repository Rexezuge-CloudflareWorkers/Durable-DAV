import { createLogger } from '@rexezuge/runtime';
import type { RemoteEntry } from '@durable-dav/backend-services/replication';
import { sweepAncestorChain, sweepOrderCompare } from '@durable-dav/backend-services/replication';
import { listCollection } from './replicaListing';
import { baseForVisited } from './replicaBase';
import type { CollectSliceOptions, Slice } from './replicaTypes';

const logger = createLogger('Replication');

/**
One level of the sweep's frontier.
*
* `children` are the collections still to visit at this level and `next` is how
* many of them have been visited. The stack of these is what a cursor describes:
* the level the cursor sits in says where the walk was, and the levels above it
* say where to go next.
*/
type FrontierLevel = {
  children: string[];
  next: number;
};

/**
 * How deep a cursor may be.
 *
 * The volume bounds a path at `MAX_PATH_DEPTH` segments, so a cursor deeper than
 * that cannot name a real collection. The cap is a backstop for a cursor that
 * somehow got there anyway: the resume lists one collection per level of the
 * path down to it, and that must not become an unbounded walk.
 */
const MAX_RESUME_DEPTH = 256;

/**
 * Walk the tree, visiting at most `maxCollections` collections.
 *
 * ## The order
 *
 * A **pre-order** over a tree whose children are sorted by name: a collection is
 * visited before the collections inside it, and a collection's whole subtree is
 * visited before its next sibling. The order itself, and the reason it has to be
 * this one, live in `sweepWindow`.
 *
 * It replaces a breadth-first walk, which had two properties that made a sliced
 * sweep impossible. Its frontier depended on the whole queue rather than on a
 * path, so no cursor could describe it — the sweep restarted from the root every
 * tick and a tree deeper than one slice was never visited at all. And the
 * collections it had visited were not a prefix of any order, so the base rows it
 * loaded were not the base rows of what it had seen.
 *
 * ## The resume
 *
 * A tick that runs out of budget parks a cursor; the next tick continues from it.
 * The cost of continuing is one listing per level of *depth* — the cursor's own
 * listing, and its ancestors' — because that is what it takes to find the
 * sibling that follows the cursor. It is bounded by the tree's depth rather than
 * by its size, which is what makes a bounded budget possible at all.
 *
 * What a failure means is `replicaListing`'s to say; the walk's part is to carry
 * it: a slice that could not see everything is not `complete`, and the gate that
 * protects the owner's files is closed for the pass.
 */
async function collectSlice(options: CollectSliceOptions): Promise<Slice> {
  const { localStub, remote, replicationId, maxCollections, deadlineMs } = options;
  const resumeFrom = options.resumeFrom ?? null;
  const localByPath = new Map<string, RemoteEntry>();
  const remoteByPath = new Map<string, RemoteEntry>();
  const visited = new Set<string>();
  const frontier: FrontierLevel[] = [];
  let complete = true;
  let errors = 0;
  let firstError: string | null = null;
  /**
  The last collection visited, in sweep order.

  Monotonic by construction: the resume re-lists the cursor's ancestors, which
  sit *before* it in the order, and a cursor must never move backwards — a cursor
  that named an earlier position would make the next tick re-cover ground that
  was already decided.
  */
  let cursor: string | null = resumeFrom;

  /**
   * List one collection on both sides, and record what it showed.
   */
  const visit = async (path: string): Promise<string[]> => {
    const listing = await listCollection({ path, localStub, remote, visited });
    for (const entry of listing.localEntries) localByPath.set(entry.path, entry);
    for (const entry of listing.remoteEntries) remoteByPath.set(entry.path, entry);
    if (!listing.complete) complete = false;
    errors += listing.errors;
    if (firstError === null) firstError = listing.firstError;
    return listing.children;
  };

  /**
   * Rebuild the frontier from a cursor.
   *
   * The cursor names the last collection the previous slice visited, so the walk
   * continues *after* it: the cursor's own children come next, and failing them
   * the sibling that follows the cursor — which is found by listing the cursor's
   * parent, and its parent's, and so on.
   *
   * `null` means the tree changed under the cursor: the collection the cursor
   * names is no longer among its parent's children, so the frontier cannot be
   * reconstructed and the sweep starts again from the root.
   */
  const resumeFrontier = async (from: string): Promise<string | null> => {
    const chain = sweepAncestorChain(from);
    // The chain is bounded by the depth of a path, which the volume already
    // bounds. The cap is here so a cursor that somehow got longer than any
    // addressable path cannot turn the resume into an unbounded walk.
    if (chain.length > MAX_RESUME_DEPTH) {
      logger.warn(`replication cursor ${from} is deeper than any addressable path; restarting the sweep from the root`);
      frontier.length = 0;
      return null;
    }
    for (let index = 0; index < chain.length - 1; index += 1) {
      const parent = chain[index] ?? '';
      const child = chain[index + 1] ?? '';
      // The ancestor counts as visited: it *was* listed, and the base rule
      // keys on the parent having been listed in this slice.
      visited.add(parent);
      const children = await visit(parent);
      const position = children.indexOf(child);
      if (position === -1) {
        logger.warn(`replication cursor ${from} is no longer reachable; restarting the sweep from the root`);
        frontier.length = 0;
        return null;
      }
      frontier.push({ children, next: position + 1 });
    }
    return from;
  };

  let resumed = false;
  let current: string | null = '';
  if (resumeFrom !== null) {
    const from = await resumeFrontier(resumeFrom);
    if (from === null) {
      // The resume was abandoned, so the sweep starts over — and the cursor goes
      // with it, because the position it named no longer means anything.
      cursor = null;
    } else {
      current = from;
      resumed = true;
    }
  }

  /**
   * How much of the slice's budget this walk has spent.
   *
   * The resume's own listings do not count against it: they re-read ground an
   * earlier slice already covered, and they are bounded by the tree's *depth*
   * rather than by its size. Counting them would let a deep tree spend its
   * whole budget re-reading the path down to the cursor and never reach the end
   * of it — which is exactly the failure the cursor exists to fix.
   */
  let budgetUsed = 0;
  let firstStep = true;

  while (current !== null) {
    if (budgetUsed >= maxCollections || Date.now() >= deadlineMs) break;
    visited.add(current);
    const children = await visit(current);
    // The first step of a resumed walk re-reads the cursor, which the previous
    // slice already listed. It is not new ground, so it does not spend the
    // budget — otherwise a slice budget of one could never get past the root.
    if (!(firstStep && resumed)) budgetUsed += 1;
    firstStep = false;
    if (cursor === null || sweepOrderCompare(current, cursor) >= 0) cursor = current;
    if (children.length > 0) {
      // Descend: the first child is the next collection in the pre-order.
      frontier.push({ children, next: 1 });
      current = children[0] ?? null;
      continue;
    }
    // No children: move to the next sibling, unwinding the frontier until a level
    // has one left.
    current = null;
    while (frontier.length > 0) {
      const level = frontier.at(-1);
      if (level === undefined) break;
      if (level.next < level.children.length) {
        current = level.children[level.next] ?? null;
        level.next += 1;
        break;
      }
      frontier.pop();
    }
  }

  if (errors > 0) complete = false;
  /**
  Whether the sweep reached the end of the tree.
  */
  const exhausted = current === null;
  /**
  The collections known to be still unvisited.

  A lower bound — the frontier only knows about the levels the walk has opened —
  but it is the number that decides whether the pass is over, and it is zero
  exactly when the walk ran out of tree rather than out of budget.
  */
  let remaining = 0;
  for (const level of frontier) remaining += level.children.length - level.next;
  // A sweep that stopped for budget reasons has work left even when the frontier
  // cannot prove it: the collection it was about to visit is not in any level.
  // Reporting zero would close the pass, and a closed pass opens the deletion
  // gate for a tree that was never covered.
  if (!exhausted && remaining === 0) remaining = 1;

  return {
    localByPath,
    remoteByPath,
    base: await baseForVisited(localStub, replicationId, visited),
    complete,
    errors,
    firstError,
    remaining,
    cursor: exhausted ? null : cursor,
  };
}

export { collectSlice };

export { type LocalReplicaStub, type CollectSliceOptions, type Slice } from './replicaTypes';
