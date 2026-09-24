# Edge-Git — Feature: Collaboration (Pulls/Issues/Search/Social)

Scope: `pull/`, `issue/`, `search/`, `social/`, `collab/`, `project/`, `discussion/`, `wiki/`, `snippet/`. Parent index: `../../../AGENTS.md`.

- **Facade + Policy split**: `PullRequestService` (CRUD/reviews/threads) + pure `PullReviewGate` (`isBlockedByReviews`/`isDismissed` — dismissed reviews stay visible but leave the gate/quorum); `BranchProtectionService` (`*`-glob longest-match, `required_approvals` 0–6 excluding creator self-approval, CODEOWNERS quorum via `TeamService.listMemberEmails`); `PullThreadService` (path/line/side + 10k caps).
- **Observer/fan-out**: `SocialEmit.recordAndNotify` (auto-watch + notification fan-out) and `publishLiveUpdate`/`publishCheckUpdate` are best-effort (never throw; every `.catch` covered by failure-injection tests). `AuditObserverRegistry.withDefaults/withObservers` is the `Injectable*Registry` analog (Otter `InjectableActionHandlerRegistry` pattern).
- **Numbering**: `allocateNumberWithFallback` (atomic `NumberingDAO` first, legacy `MAX+1` only on missing-table/fake-DB; unknown-entity + genuine D1 errors rethrow — fail-closed).
- **Search**: `SearchService` (`sanitizeQuery` 2–200, `clampLimit` ≤50, over-fetch ×3 then `PermissionService` filter); `SearchDAO` FTS-first + LIKE-fallback + legacy-degrade per entity; code index in `SearchCodeIndexDAO` + generic `SearchFtsRunner` (planned extraction — see readability notes).
- Routes stay thin facades: `PullUserRoutes` → `PullUserReadRoutes` + `PullUserWriteRoutes`; `collab/` split (`Label|Milestone|IssueTriage|PullTriage|ForkSync|BlameRoutes`); `CodeownerHelpers` list-then-read (no exception-driven `readBlob`).
