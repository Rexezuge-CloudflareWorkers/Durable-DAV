import type { DavVolumeDAO } from '@durable-dav/backend-data/dao';

/**
 * The target bucket of a `dav-volume` replication, and whether it exists.
 *
 * ## Why this is checked at all
 *
 * `DAV_VOLUME.getByName` **creates** the Durable Object it names. A target
 * naming a bucket that does not exist therefore does not fail — it creates one,
 * writes the owner's files into it, and reports every run as `ok`.
 *
 * The bucket it creates is an *orphan*: it has no `dav_volumes` row, so it is
 * reachable from neither the dashboard nor WebDAV, and no name addresses it.
 * The owner's files are in it, and the owner cannot see them.
 *
 * That is the whole difference between a replication that works and one that
 * silently does nothing, and it is invisible from the outside: the target row
 * looks configured, the run says `ok`, and the source bucket is intact — which
 * is exactly what "the sync says success but nothing is copied" looks like.
 *
 * The check is against the **registry** rather than against the object, and it
 * runs *before* the object is named, because naming it is what creates it.
 *
 * ## Why it is asked twice
 *
 * Once when the target is configured, where the owner can still be told which
 * half of the name is wrong, and once per run, for a bucket that has since been
 * deleted or renamed. The second answer is a recorded failure and the first is a
 * `400`, but the question is the same either way, so it is asked by one
 * function.
 */

/**
 * The message that says the target is missing, or `null` when it is not.
 *
 * `null` rather than a boolean so the answer and the words that explain it
 * cannot drift apart: a caller that wants to fail has the sentence it needs.
 */
async function missingTargetVolume(volumeDAO: DavVolumeDAO, owner: string, volume: string): Promise<string | null> {
  const existing = await volumeDAO.getByOwnerName(owner, volume);
  if (existing !== null) return null;
  return `the bucket ${owner}/${volume} does not exist`;
}

export { missingTargetVolume };
