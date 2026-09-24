# Edge-Git — Feature: Git Protocol + Repos

Scope: git data plane (`packages/git-protocol`, `packages/git-service`, `apps/background` DOs). Parent index: `../../../AGENTS.md`. Mirrors Otter/AWS `docs/agents/features/*` per-domain split.

- `git-protocol` (Layer 2): pkt-line codec + v2 fetch/receive builders/parsers + `PackLimits`/`ContentLimits`. Pure, no I/O — unit-test without DO.
- `git-service` (Layer 2-3): `GitService` facade over `IsoGitFs` (`DofsFsAdapter.createDofsFs`) + `GitCache` mixin. OO roles:
  - **Facade**: `GitService`, `HistoryService` (log/tree/blob), `WriteService` (upsert/delete with `pathExistsAt` tree-walk, never exception-driven `readBlob` on hot paths — workerd dangling-rejection quirk).
  - **Policy** (pure, extracted): `RefValidation` (`ZERO_OID`, `isCommitOid`, `branchRefFor`, `classifyRefCommand`), `RefParsers` (`parseSymbolicHead`), `PackLimits`, `DiffHunks`, `MergeService` branch-name re-export (canonical rule in `@duradav/shared/utils`).
  - **Adapter**: `DofsFsAdapter` (dofs device), `TreeReader`, `PackCollector`, `ObjectReader`.
- `RefService.applyRefUpdates` is two-phase (validate → mutate, atomic flag maps partial success to full failure) and must use `this.gitdir` everywhere — the old hardcoded `/repo` broke non-standard isolates (fixed in hardening).
- DOs: `RepoWorker` thin facade (routing + composition) → `RepoLifecycle` (init/limits/purge) + `FetchHandler`/`PushHandler` + `RepoReadRpc`/`ReadModelService` + `ReleaseAssetStore` (`/release-assets` outside `/repo`, 5GB device).
