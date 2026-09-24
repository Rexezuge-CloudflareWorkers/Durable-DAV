import type { BranchProtectionRuleMetadata } from '@duradav/shared';

function matchesPattern(pattern: string, branch: string): boolean {
  const escaped = pattern.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`).test(branch);
}

function matchRule(rules: readonly BranchProtectionRuleMetadata[], branch: string): BranchProtectionRuleMetadata | null {
  let best: BranchProtectionRuleMetadata | null = null;
  for (const rule of rules) {
    if (!matchesPattern(rule.pattern, branch)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.pattern < best.pattern)
    ) {
      best = rule;
    }
  }
  return best;
}

function countApprovals(reviews: Array<{ author_email: string; state: string; dismissed?: number | null }>, creatorEmail: string): number {
  const creator = creatorEmail.toLowerCase();
  const latestByAuthor = new Map<string, string>();
  for (const review of reviews) {
    if (review.dismissed === 1) continue;
    latestByAuthor.set(review.author_email.toLowerCase(), review.state);
  }
  let approvals = 0;
  for (const [author, state] of latestByAuthor) {
    if (author !== creator && state === 'approved') approvals += 1;
  }
  return approvals;
}

export { matchesPattern, matchRule, countApprovals };
