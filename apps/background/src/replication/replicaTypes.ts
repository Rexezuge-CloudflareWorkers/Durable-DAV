import type { PlanBase, RemoteEntry, RemoteVolume } from '@durable-dav/backend-services/replication';
import type { ReplicaStateRow } from '@durable-dav/dav-store';

/**
 * The shapes the replication slice is made of.
 *
 * Split out of `collectSlice` because three modules need them and none of them
 * owns them: the walker (`collectSlice`), the listing it drives
 * (`replicaListing`) and the executor that acts on what it saw
 * (`PlanExecutor`). Keeping them here means a change to the slice's shape has
 * one home rather than three.
 */

/**
One collection listing from the local volume DO, with its completeness claim.
*/
export type ReplicaListing = {
  entries: RemoteEntry[];
  complete: boolean;
};

/**
The slice's view of the volume Durable Object holding the local side.
*/
export interface LocalReplicaStub {
  /**
   * Direct children of one collection, with the volume's own statement of
   * whether the listing is complete.
   *
   * The flag is checked on the local side too, not just the remote's. A partial
   * local listing makes a path look absent from *this* bucket, which is not
   * destructive the way a false remote absence is — it queues a pull instead of a
   * delete — but it is still the planner acting on evidence that does not exist,
   * and it can overwrite a local copy with a stale remote one.
   */
  listReplicaChildren(path: string): Promise<ReplicaListing>;
  readReplicaStream(path: string): Promise<ReadableStream<Uint8Array> | null>;
  readReplicaBytes(path: string): Promise<Uint8Array | null>;
  applyReplicaOperations(replicationId: string, operations: unknown[]): Promise<{ applied: number; failed: number; error: string | null }>;
  loadReplicaStateRows(replicationId: string): Promise<ReplicaStateRow[]>;
  forgetReplication(replicationId: string): Promise<void>;
}

/**
What one slice of a pass saw, and what it could not see.
*/
export type Slice = {
  localByPath: Map<string, RemoteEntry>;
  remoteByPath: Map<string, RemoteEntry>;
  base: PlanBase[];
  /**
  Every collection listed completely on both sides, with no errors.
  */
  complete: boolean;
  /**
  Collections that could not be listed. Any value closes the deletion gate.
  */
  errors: number;
  /**
  First listing error, for the run record.
  */
  firstError: string | null;
  remaining: number;
  cursor: string | null;
};

export type CollectSliceOptions = {
  localStub: LocalReplicaStub;
  remote: RemoteVolume;
  replicationId: string;
  maxCollections: number;
  deadlineMs: number;
  /**
  Where the previous slice stopped, or `null` to start a fresh pass.
  *
  The cursor names the last collection the previous slice visited, and the sweep
  continues *after* it. It is the whole of the sweep's memory between ticks, so
  it has to be enough on its own — which is why the sweep order is a pre-order
  (see `sweepWindow`).
  */
  resumeFrom?: string | null;
};
