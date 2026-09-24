import { BadRequestError } from '@duradav/backend-errors';

// Quota Policy (Policy pattern): single fail-closed limit check shared by
// `TeamService` (teams/members/grants), `OrganizationService`, and
// `DiscussionService`. Pure and unit-testable without D1: count + max in,
// `BadRequestError` out. Counts come from best-effort DAO reads that degrade
// to 0, so the check fails open only when the DAO itself is unreachable —
// the same contract the inline `count >= max` guards had.
function assertQuotaWithinLimit(count: number, max: number, noun: string): void {
  if (count >= max) throw new BadRequestError(`Maximum of ${max} ${noun} reached`);
}

export { assertQuotaWithinLimit };
