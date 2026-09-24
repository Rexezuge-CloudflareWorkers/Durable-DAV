import { BadRequestError, ForbiddenError } from '@duradav/backend-errors';

const MAX_REPO_DESCRIPTION_LENGTH = 500;

/**
 * Pure repository create/update policy (Policy pattern).
 *
 * `RepoService.createRepo` mixed name validation, quota checks, and
 * self-vs-org-vs-legacy path branching with DAO orchestration. The pure
 * decisions live here — unit-testable without D1 — while the service keeps
 * only the DAO lookups that feed `classifyCreatePath`.
 */
function validateRepoPatch(patch: { description?: string | null; isPrivate?: boolean }): void {
  if (typeof patch.description === 'string' && patch.description.length > MAX_REPO_DESCRIPTION_LENGTH) {
    throw new BadRequestError('Description must be 500 characters or fewer');
  }
  if (patch.isPrivate !== undefined && typeof patch.isPrivate !== 'boolean') {
    throw new BadRequestError('isPrivate must be a boolean');
  }
}

function checkRepoQuota(ownedCount: number, max: number): void {
  if (ownedCount >= max) {
    throw new BadRequestError(`Maximum ${max} repositories per user`);
  }
}

type RepoCreatePath =
  { kind: 'self' } | { kind: 'org'; orgId: string; owner: string } | { kind: 'legacy' } | { kind: 'forbidden'; reason: string };

/**
 * Decide the create path from already-resolved lookups.
 *
 * Precedence is load-bearing: self-owned fast path first (covers legacy
 * fakes with no users/orgs tables), then org membership, then the legacy
 * free-form fallback guarded against namespace hijack.
 */
function classifyCreatePath(input: {
  ownerCi: string;
  callerCi: string | null;
  org: { id: string; username: string } | null;
  isOrgMember: boolean;
  namespaceOwnerEmail: string | null;
  callerEmail: string;
}): RepoCreatePath {
  if (input.callerCi && input.ownerCi === input.callerCi) return { kind: 'self' };
  if (input.org) {
    if (!input.isOrgMember) {
      return { kind: 'forbidden', reason: 'Only organization members can create repositories for this organization' };
    }
    return { kind: 'org', orgId: input.org.id, owner: input.org.username };
  }
  if (input.namespaceOwnerEmail && input.namespaceOwnerEmail !== input.callerEmail) {
    return { kind: 'forbidden', reason: 'Only the repository owner can perform this action' };
  }
  return { kind: 'legacy' };
}

function throwIfForbidden(path: RepoCreatePath): asserts path is Exclude<RepoCreatePath, { kind: 'forbidden' }> {
  if (path.kind === 'forbidden') throw new ForbiddenError(path.reason);
}

export { validateRepoPatch, checkRepoQuota, classifyCreatePath, throwIfForbidden, MAX_REPO_DESCRIPTION_LENGTH };
export type { RepoCreatePath };
