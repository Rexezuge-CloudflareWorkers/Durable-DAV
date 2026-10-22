import { BadRequestError } from '@rexezuge/errors';
import type { DavVolumeDAO, ReplicationTarget } from '@durable-dav/backend-data/dao';
import { missingTargetVolume } from '../replication/targetVolume';
import {
  MAX_NAME_LENGTH,
  REPLICATION_TARGET_KINDS,
  normalizeRemotePath,
  oneOf,
  optionalString,
  requireRemoteUrl,
} from './replicationInput';
import type { ReplicationCreateInput } from './replicationInput';

/**
 * The target of a replication, resolved and checked.
 *
 * Split out of `VolumeReplicationService` because the target is the one part of
 * a create that has *rules* rather than plumbing: which fields exist depends on
 * the kind of target, a `dav-volume` target names a bucket on this deployment
 * and a `dav` target names a URL on another one, and each has a way of being
 * wrong that the owner has to be told about in terms of the field they have to
 * fix.
 */
async function resolveTarget(options: {
  input: ReplicationCreateInput;
  /**
   * The path of the bucket doing the replicating, so a target that names it
   * itself can be refused.
   */
  localPath: string;
  /**
   * The egress allowlist, for a `dav` target's URL.
   */
  allowedHosts: string[];
  /**
   * The volume registry, for a `dav-volume` target's bucket.
   */
  volumeDAO: () => Promise<DavVolumeDAO>;
}): Promise<ReplicationTarget> {
  const { input, localPath, allowedHosts, volumeDAO } = options;
  const targetKind = oneOf(input.targetKind, REPLICATION_TARGET_KINDS, 'targetKind');
  const remotePath = normalizeRemotePath(input.remotePath);
  const remoteUrl = targetKind === 'dav' ? requireRemoteUrl(input.remoteUrl, allowedHosts) : '';
  const remoteOwner = targetKind === 'dav-volume' ? optionalString(input.remoteOwner, 'remoteOwner', MAX_NAME_LENGTH) : '';
  const remoteVolume = targetKind === 'dav-volume' ? optionalString(input.remoteVolume, 'remoteVolume', MAX_NAME_LENGTH) : '';

  if (targetKind === 'dav-volume') {
    if (remoteOwner === '' || remoteVolume === '') {
      throw new BadRequestError('remoteOwner and remoteVolume are required when targetKind is dav-volume');
    }
    // Compared on the volume *path*, not the id: the Durable Object is keyed
    // by path, so a bucket replicating to itself would deadlock — the runner
    // would call the same object it is already executing inside.
    if (`${remoteOwner}/${remoteVolume}`.toLowerCase() === localPath.toLowerCase()) {
      throw new BadRequestError('A volume cannot replicate to itself');
    }
    // The target bucket must already exist.
    //
    // Refusing the configuration is the only moment at which the owner can
    // still be told which half of the name is wrong. The rule and the reason
    // for it live in `targetVolume`, because the run-time check asks the same
    // question.
    const missing = await missingTargetVolume(await volumeDAO(), remoteOwner, remoteVolume);
    if (missing !== null) {
      throw new BadRequestError(`remoteOwner/remoteVolume: ${missing} — create it before adding this target`);
    }
  }

  return { targetKind, remoteUrl, remoteOwner, remoteVolume, remotePath };
}

export { resolveTarget };
