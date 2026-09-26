import type { DavVolumeDAO } from '@durable-dav/backend-data/dao';

// Owner rename: a single `dav_volumes` UPDATE. `owner_email` is the stable
// identity key (credentials bind to stable `volume_id`), so only the
// display `owner`/`owner_ci` columns move — mirroring Git
// `repoRenameCascade.cascadeOwnerRepos`. DO isolate moves stay in the API
// layer (`VolumeMove.moveVolumeDosForRename`, driven by route-level
// snapshots).
interface VolumeRenameCascadeDeps {
  volumeDAO: () => Promise<Pick<DavVolumeDAO, 'renameOwner'>>;
}

async function cascadeOwnerVolumes(
  deps: VolumeRenameCascadeDeps,
  input: { oldOwnerCi: string; newOwner: string; now: number },
): Promise<void> {
  const volumeDAO = await deps.volumeDAO();
  await volumeDAO.renameOwner(input.oldOwnerCi, input.newOwner, input.now);
}

export { cascadeOwnerVolumes };
export type { VolumeRenameCascadeDeps };
