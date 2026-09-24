import { BadRequestError } from '@duradav/backend-errors';

/**
 * Pure last-privileged-member guards (Policy pattern).
 *
 * `TeamService` (last team `admin`) and `OrganizationService` (last org
 * `owner`) duplicated the same `countPrivileged <= 1` demote/remove check
 * inline. Both delegate here so the rule — demoting or removing the final
 * privileged member is rejected — is unit-testable without D1 and stays
 * identical across teams and orgs.
 */
function assertNotLastPrivilegedMember(input: {
  currentRole: string;
  privilegedRole: string;
  privilegedCount: number;
  action: 'demote' | 'remove';
  subjectNoun: string;
}): void {
  if (input.currentRole !== input.privilegedRole) return;
  if (input.privilegedCount > 1) return;
  const verb = input.action === 'demote' ? 'demote' : 'remove';
  throw new BadRequestError(`Cannot ${verb} the last ${input.subjectNoun}`);
}

function assertNotLastTeamAdmin(currentRole: string, adminCount: number, action: 'demote' | 'remove'): void {
  assertNotLastPrivilegedMember({
    currentRole,
    privilegedRole: 'admin',
    privilegedCount: adminCount,
    action,
    subjectNoun: 'team admin',
  });
}

function assertNotLastOrgOwner(currentRole: string, ownerCount: number, action: 'demote' | 'remove'): void {
  assertNotLastPrivilegedMember({
    currentRole,
    privilegedRole: 'owner',
    privilegedCount: ownerCount,
    action,
    subjectNoun: 'owner',
  });
}

export { assertNotLastPrivilegedMember, assertNotLastTeamAdmin, assertNotLastOrgOwner };
