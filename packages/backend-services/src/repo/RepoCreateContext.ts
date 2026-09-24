import { EmailAddress, TimestampUtil, repoDoKeyForFullName } from '@duradav/shared/utils';
import type { RepositoryRow } from '@duradav/backend-data/dao';
import type { RepoServiceDeps } from './RepoService';

interface CreationLookup {
  org: { id: string; username: string } | null;
  isOrgMember: boolean;
  namespaceOwnerEmail: string | null;
}

/**
 * Creation-context resolver for `RepoService.createRepo` (Strategy pattern).
 *
 * Why: `createRepo` mixed three independent best-effort lookups
 * (org/member/namespace) with pure precedence (`classifyCreatePath`).
 * Each lookup degrades to null/false independently so minimal fakes without
 * users/orgs tables still create self-owned repos; production with
 * `strictSchema` fails closed downstream via `PermissionService`.
 */
async function resolveCreationContext(
  deps: Pick<Required<RepoServiceDeps>, 'organizationDAO' | 'organizationMemberDAO' | 'namespaceDAO'>,
  input: { ownerCi: string; callerCi: string | null; callerEmail: string },
): Promise<CreationLookup> {
  let org: CreationLookup['org'] = null;
  try {
    const orgDao = await deps.organizationDAO();
    org = await orgDao.getByUsernameCi(input.ownerCi);
  } catch {
    org = null;
  }
  let isOrgMember = false;
  if (org) {
    try {
      const memberDao = await deps.organizationMemberDAO();
      isOrgMember = (await memberDao.get(org.id, input.callerEmail)) !== null;
    } catch {
      isOrgMember = false;
    }
  }
  let namespaceOwnerEmail: string | null = null;
  if (!org && (!input.callerCi || input.ownerCi !== input.callerCi)) {
    try {
      const nsDao = await deps.namespaceDAO();
      const ns = await nsDao.get(input.ownerCi);
      namespaceOwnerEmail = ns?.user_email?.toLowerCase() ?? null;
    } catch {
      namespaceOwnerEmail = null;
    }
  }
  return { org, isOrgMember, namespaceOwnerEmail };
}

async function resolveCallerUsernameLowercased(userDAO: RepoServiceDeps['userDAO'], userEmail: string): Promise<string | null> {
  const normalized = EmailAddress.normalize(userEmail);
  try {
    const dao = await userDAO?.();
    const user = await dao?.getByEmail(normalized);
    if (user?.username) return user.username.toLowerCase();
  } catch {
    // ignore — fall back to email prefix below (covers fakes without users table).
  }
  const prefix = normalized.split('@', 1)[0]?.toLowerCase() ?? '';
  return prefix || null;
}

/**
 * Vacuum-tombstone helper for `RepoService.deleteRepo` (Observer pattern).
 *
 * Why: the synchronous DO purge in the route already removed live content;
 * a missed tombstone only leaks reclaimed-later SQLite pages, never
 * user-visible data — so this stays best-effort and never throws.
 */
async function enqueueVacuumTombstone(deps: Pick<Required<RepoServiceDeps>, 'deletedRepoDoDAO'>, repo: RepositoryRow): Promise<void> {
  try {
    const tombstones = await deps.deletedRepoDoDAO();
    const fullName = `${repo.owner}/${repo.name}`;
    await tombstones.enqueue(repoDoKeyForFullName(fullName), fullName, repo.id, TimestampUtil.getCurrentUnixTimestampInSeconds());
  } catch (error) {
    // Best-effort by design; `console.warn` (not injected Logger) because
    // this path also runs in DO/worker isolates without a scoped logger.
    console.warn(`[WARN] [repoCleanup] vacuum tombstone enqueue failed: ${String(error)}`);
  }
}

export { resolveCreationContext, resolveCallerUsernameLowercased, enqueueVacuumTombstone };
export type { CreationLookup };
