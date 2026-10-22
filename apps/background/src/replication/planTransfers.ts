import { createLogger } from '@rexezuge/runtime';
import type { LocalReplicaStub, Slice } from './replicaTypes';
import type { PlanBase, RemoteVolume } from '@durable-dav/backend-services/replication';
import { CryptoUtil } from '@rexezuge/shared';

const logger = createLogger('Replication');

/**
 * The ways a plan moves bytes, and nothing else.
 *
 * Split out of `PlanExecutor` for one reason: `pull-and-preserve` is a whole
 * transfer strategy rather than one more branch of a switch, and folding it in
 * would have put a 40-line method and its reasoning inside the file whose job is
 * to orchestrate a batch. The rule it exists to state is simple enough that it
 * should be readable on its own:
 *
 * > `pull-only` never writes to the remote.
 *
 * Every other mode may write in both directions. This one writes down only, and the
 * local version it would have overwritten is preserved beside the path rather than
 * discarded. That is what makes "the remote is the authority" a statement about
 * *precedence* rather than about destroying the owner's work.
 *
 * The plain transfers live here for the same reason: a transfer that moved
 * nothing is a failure, and the rule for that belongs with the transfers rather
 * than with the batch that counts them.
 */

type TransferContext = {
  localStub: LocalReplicaStub;
  remote: RemoteVolume;
  replicationId: string;
  slice: Slice;
  /**
   * The recorded base, by path.
   *
   * Indexed rather than searched: a transfer asks "what did the remote last
   * hold here?" for every path it moves, and a linear search per path over a
   * base of a few thousand rows is a few thousand comparisons per slice.
   */
  baseByPath: ReadonlyMap<string, PlanBase>;
  /**
   * Errors found applying a batch of local operations, or `null` when they all
   * landed. Thrown so the caller records one failed path rather than a silently
   * half-applied transfer.
   */
  applied(result: { failed: number; error: string | null }, what: string): void;
};

/**
 * `keep-both`: preserve the losing version on both sides.
 *
 * The winner stays at `path`; each side's bytes are copied into the *other* side's
 * conflict slot, so both keep a copy and a person can recover the edit they did not
 * expect to lose.
 */
async function keepBoth(context: TransferContext, path: string, conflictPath: string): Promise<void> {
  if (await preserveConflictingCollection(context, path, conflictPath)) return;

  const { localStub, remote, slice } = context;
  const localEntry = slice.localByPath.get(path);
  const remoteEntry = slice.remoteByPath.get(path);
  const remoteStream = remoteEntry === undefined || remoteEntry.isCollection ? null : await remote.readFile(path);
  if (remoteStream !== null) {
    context.applied(
      await localStub.applyReplicaOperations(context.replicationId, [
        { op: 'write', path: conflictPath, contentType: localEntry?.contentType ?? null, data: remoteStream },
      ]),
      'writing the conflict copy locally',
    );
  }
  if (localEntry === undefined || localEntry.isCollection) return;
  const localStream = await localStub.readReplicaStream(path);
  if (localStream !== null) await remote.writeFile(conflictPath, localStream, { contentType: localEntry.contentType, ifMatch: null });
}

/**
 * `pull-and-preserve`: the remote's version lands at `path`, the local version is
 * kept at `conflictPath`, and the remote is not written at all.
 *
 * Ordering is the safety argument. The local bytes are copied to the conflict path
 * **before** the remote's version is written over `path`, so a failure between the
 * two leaves the original intact rather than truncating it in place — the same
 * ordering `dofs.writeFile` uses for the quota check, and for the same reason.
 *
 * A collection is not a byte stream, so it takes the structural path instead: the
 * remote's `makeCollection` and the local `mkdir` are both idempotent, and there is
 * nothing at `path` whose bytes need preserving beyond the collection itself.
 */
async function pullAndPreserve(context: TransferContext, path: string, conflictPath: string, contentType: string | null): Promise<void> {
  const { localStub, remote, replicationId, slice } = context;
  const localEntry = slice.localByPath.get(path);
  const remoteEntry = slice.remoteByPath.get(path) ?? (await remote.stat(path));
  const remoteIsCollection = remoteEntry?.isCollection === true;
  const localIsCollection = localEntry?.isCollection === true;

  if (localIsCollection || localEntry === undefined) {
    // Nothing at `path` whose bytes would be lost, so this is an ordinary create.
    if (remoteIsCollection) {
      context.applied(await localStub.applyReplicaOperations(replicationId, [{ op: 'mkdir', path }]), 'local mkdir');
      return;
    }
    await remoteToLocal(context, path, contentType);
    return;
  }

  if (remoteIsCollection) {
    // Collection replacing file: there is no remote bytes to write, and the local
    // file is preserved whole rather than being lost to a directory that replaced it.
    context.applied(
      await localStub.applyReplicaOperations(replicationId, [{ op: 'mkdir', path: conflictPath }]),
      'writing the conflict collection',
    );
    context.applied(
      await localStub.applyReplicaOperations(replicationId, [{ op: 'unlink', path, recursive: false }]),
      'replacing a file with a collection',
    );
    context.applied(await localStub.applyReplicaOperations(replicationId, [{ op: 'mkdir', path }]), 'local mkdir');
    return;
  }

  const localStream = await localStub.readReplicaStream(path);
  if (localStream === null) {
    // The local side could not be read, so there is nothing to preserve and nothing
    // to compare against. Pulling would overwrite bytes nobody captured.
    logger.warn(`pull-only: ${path} was not readable locally; leaving it untouched rather than overwriting it`);
    return;
  }
  context.applied(
    await localStub.applyReplicaOperations(replicationId, [
      { op: 'write', path: conflictPath, contentType: localEntry.contentType, data: localStream },
    ]),
    'preserving the local version',
  );
  await remoteToLocal(context, path, contentType);
}

/**
 * Write the remote's version down to `path`.
 */
async function remoteToLocal(context: TransferContext, path: string, contentType: string | null): Promise<void> {
  const { localStub, remote, replicationId } = context;
  const stream = await remote.readFile(path);
  if (stream === null) return;
  context.applied(
    await localStub.applyReplicaOperations(replicationId, [{ op: 'write', path, contentType, data: stream }]),
    'writing the remote version locally',
  );
}

/**
 * Local -> remote.
 *
 * Every way this can fail throws. A push that moved nothing and reported
 * success is the failure this whole feature exists to prevent: the run said
 * `ok`, the mirror stayed empty, and the owner had no way to tell that the
 * bytes never left the bucket. A silent no-op is worse than an error, because
 * an error closes the deletion gate and a silent no-op does not.
 */
async function pushTransfer(context: TransferContext, path: string): Promise<number | null> {
  const { localStub, remote, slice } = context;
  const localEntry = slice.localByPath.get(path);
  if (localEntry === undefined) throw new Error(`the local side has no entry for ${path}`);
  if (localEntry.isCollection) {
    await remote.makeCollection(path);
    return 0;
  }
  const stream = await localStub.readReplicaStream(path);
  if (stream === null) throw new Error(`the local file ${path} could not be read`);
  await remote.writeFile(path, stream, { contentType: localEntry.contentType, ifMatch: null });
  noteMirrorRepair(context, path);
  return localEntry.size ?? 0;
}

/**
 * Remote -> local.
 */
async function pullTransfer(context: TransferContext, path: string, contentType: string | null): Promise<number | null> {
  const { localStub, remote, replicationId, slice } = context;
  // `ifMatch` carries the ETag we last saw, so a concurrent human write is
  // rejected rather than silently overwritten. Absent on a first write, which is
  // the only time omitting it is correct.
  const remoteEntry = slice.remoteByPath.get(path) ?? (await remote.stat(path));
  if (remoteEntry === null) throw new Error(`the remote has no entry for ${path}`);
  if (remoteEntry.isCollection) {
    context.applied(await localStub.applyReplicaOperations(replicationId, [{ op: 'mkdir', path }]), 'local mkdir');
    return 0;
  }
  const stream = await remote.readFile(path);
  if (stream === null) throw new Error(`the remote file ${path} could not be read`);
  context.applied(await localStub.applyReplicaOperations(replicationId, [{ op: 'write', path, contentType, data: stream }]), 'local write');
  return remoteEntry.size ?? 0;
}

/**
 * Settle an ambiguous pair by hashing both sides.
 *
 * Opt-in, because it costs two full reads of every file whose validators
 * disagree but whose sizes match. Equal hashes mean the two sides are recorded
 * as agreeing; different hashes mean the winner takes the path.
 */
async function compareContent(context: TransferContext, path: string, winner: 'local' | 'remote'): Promise<number | null> {
  const { localStub, remote, slice } = context;
  const [localBytes, remoteStream] = await Promise.all([localStub.readReplicaBytes(path), remote.readFile(path)]);
  if (localBytes === null) throw new Error(`the local file ${path} could not be read`);
  if (remoteStream === null) throw new Error(`the remote file ${path} could not be read`);
  const remoteBytes = new Uint8Array(await new Response(remoteStream).arrayBuffer());
  const [localHash, remoteHash] = await Promise.all([CryptoUtil.sha256HexOfBytes(localBytes), CryptoUtil.sha256HexOfBytes(remoteBytes)]);
  if (localHash === remoteHash) {
    logger.info(`replication content hash matched for ${path}`);
    return 0;
  }
  logger.info(`replication content hash differs for ${path}; applying the ${winner} side`);
  return winner === 'local' ? pushTransfer(context, path) : pullTransfer(context, path, slice.remoteByPath.get(path)?.contentType ?? null);
}

/**
 * Note that a push repaired a diverged mirror.
 *
 * A repair is a push over a version the remote had changed on its own: the
 * mirror had drifted from its source, and the source is authoritative. It is
 * not a conflict — one side is the authority, so there is nothing to reconcile
 * and no conflict row is written — which leaves the log as the only place the
 * repair is visible.
 *
 * A push over a remote that still holds the version the base recorded is an
 * ordinary transfer, not a repair: the remote is stale, which is what a mirror
 * is for.
 */
function noteMirrorRepair(context: TransferContext, path: string): void {
  const remoteEntry = context.slice.remoteByPath.get(path);
  if (remoteEntry === undefined) return;
  const base = context.baseByPath.get(path);
  if (base === undefined || base.remoteEtag === null || base.remoteEtag === remoteEntry.etag) return;
  logger.info(`replication repaired a diverged mirror at ${path}`);
}

/**
 * The collection-vs-something cases of `keepBoth`.
 *
 * Returns whether it handled the path, so the caller can open with the exception
 * rather than burying it above two `const` declarations.
 */
async function preserveConflictingCollection(context: TransferContext, path: string, conflictPath: string): Promise<boolean> {
  const { localStub, remote, replicationId, slice } = context;
  const localIsCollection = slice.localByPath.get(path)?.isCollection === true;
  if (localIsCollection) {
    await remote.makeCollection(conflictPath);
    return true;
  }
  const remoteIsCollection = slice.remoteByPath.get(path)?.isCollection === true;
  // Nothing to preserve when the local side holds the bytes — that is the
  // file-vs-file case, handled by the caller.
  if (!remoteIsCollection || slice.localByPath.has(path)) return false;
  context.applied(
    await localStub.applyReplicaOperations(replicationId, [{ op: 'mkdir', path: conflictPath }]),
    'writing the conflict collection',
  );
  return true;
}

export { keepBoth, pullAndPreserve, pushTransfer, pullTransfer, compareContent };
export type { TransferContext };
