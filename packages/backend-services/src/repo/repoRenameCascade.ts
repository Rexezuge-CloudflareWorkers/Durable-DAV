import type { RepositoryDAO } from '@duradav/backend-data/dao';

// Owner rename: a single `repositories` UPDATE. Display names everywhere else
// are computed from `repositories` (0024 dropped the stored `full_name`
// copies), so no D1 cascade is needed — FTS follows via the
// `trg_repo_rename_fts_au` trigger. DO isolate moves stay in the API layer
// (`RepoMove.moveRepoDosForRename`, driven by route-level snapshots).
interface RepoRenameCascadeDeps {
  repositoryDAO: () => Promise<Pick<RepositoryDAO, 'renameOwner'>>;
}

async function cascadeOwnerRepos(
  deps: RepoRenameCascadeDeps,
  input: { oldOwnerCi: string; newOwner: string; now: number },
): Promise<void> {
  const repoDAO = await deps.repositoryDAO();
  await repoDAO.renameOwner(input.oldOwnerCi, input.newOwner, input.now);
}

export { cascadeOwnerRepos };
export type { RepoRenameCascadeDeps };
