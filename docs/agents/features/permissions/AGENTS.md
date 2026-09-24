# Edge-Git — Feature: Permissions + Visibility

Scope: authz (`PermissionService`, `RepoVisibilityService`, `AccessAuthService`, `TokenService`). Parent index: `../../../AGENTS.md`.

- **Policy + Facade**: `PermissionService.getRole(viewerEmail|null, repo)` → `admin|write|read|null` is the single authz decision point (org owners implicit admin; max of direct collaborator grant + same-org team grants, batched positional membership so legacy rows without `team_id` resolve). `RepoVisibilityService` is the read-model facade (search/realtime/route guards reuse it without the write path).
- **Fail-closed**: `strictSchema` (prod `true` via `isBypassAllowed`) turns missing-table degrades into `DatabaseError`; `gitAuthForRepo` maps `DatabaseError` → 503, bad token → 401. Private repos hide existence (public → 404, git → 401).
- **Strategy**: `AccessAuthService` chain `DEMO_MODE → DEV_AUTH_EMAIL → JWT → ctx.access`; PATs `sha256("duradav-pat:"+token)`, `coversScope` hierarchy (`admin > write > read`), legacy NULL rows = full.
- Composition: exactly one `PermissionService` binding in `serviceBindings/coreServices.ts`; dependents resolve via container thunk, never `new`.
