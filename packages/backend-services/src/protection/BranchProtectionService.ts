import { BranchProtectionDAO } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { BranchProtectionRuleMetadata } from '@duradav/shared';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { isBlockedByReviews } from '../pull/PullReviewGate';
import {
  countApprovals as countApprovalsPolicy,
  matchRule as matchRulePolicy,
  matchesPattern as matchesPatternPolicy,
} from './BranchProtectionPolicy';

interface BranchProtectionServiceEnv {
  DB: D1Queryable;
  MAX_RULES_PER_REPO?: string;
}

interface BranchProtectionServiceDeps {
  branchProtectionDAO?: () => Promise<BranchProtectionDAO>;
}

const MAX_REQUIRED_APPROVALS = 6;
const MAX_STATUS_CHECKS = 20;

const RULE_PATTERN_RE = /^[\w./*-]{1,255}$/i;

function isValidRulePattern(pattern: string): boolean {
  if (!RULE_PATTERN_RE.test(pattern)) return false;
  if (pattern.startsWith('/') || pattern.endsWith('/')) return false;
  if (pattern.includes('..') || pattern.includes('//')) return false;
  if (pattern.includes('**')) return false;
  return pattern.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..');
}

function matchesPattern(pattern: string, branch: string): boolean {
  return matchesPatternPolicy(pattern, branch);
}

class BranchProtectionService {
  private readonly deps: Required<BranchProtectionServiceDeps>;

  constructor(
    private readonly env: BranchProtectionServiceEnv,
    deps: BranchProtectionServiceDeps = {},
  ) {
    this.deps = {
      branchProtectionDAO: () => Promise.resolve(new BranchProtectionDAO(env.DB)),
      ...deps,
    };
  }

  public static isValidRulePattern(pattern: string): boolean {
    return isValidRulePattern(pattern);
  }

  public static matchesPattern(pattern: string, branch: string): boolean {
    return matchesPattern(pattern, branch);
  }

  /**
   * Longest matching pattern wins (most specific rule). Ties prefer the
   * lexicographically smaller pattern for determinism.
   */
  public static matchRule(rules: readonly BranchProtectionRuleMetadata[], branch: string): BranchProtectionRuleMetadata | null {
    return matchRulePolicy(rules, branch);
  }

  /**
   * Count distinct approvers from latest-per-author reviews, excluding the
   * PR creator (self-approval never counts). `commented` reviews are neutral.
   * Dismissed reviews never count.
   * @deprecated Import countApprovals from BranchProtectionPolicy directly;
   * kept for test compat.
   */
  public static countApprovals(
    reviews: Array<{ author_email: string; state: string; dismissed?: number | null }>,
    creatorEmail: string,
  ): number {
    return countApprovalsPolicy(reviews, creatorEmail);
  }

  /**
   * Merge gate for a protected base branch: `changes_requested` vetoes
   * (shared with PullReviewGate.isBlockedByReviews), then the approval
   * quorum applies, then the CODEOWNERS quorum (when owners resolve for the
   * changed paths: at least one non-creator owner approval is required).
   * Returns a human-readable reason when blocked.
   */
  public static checkMergeBlocked(input: {
    rule: BranchProtectionRuleMetadata | null;
    reviews: Array<{ author_email: string; state: string; dismissed?: number | null }>;
    creatorEmail: string;
    codeowners?: { owners: string[] };
  }): { blocked: boolean; reason: string | null } {
    if (isBlockedByReviews(input.reviews)) {
      return { blocked: true, reason: 'pull request has unresolved change requests' };
    }
    const required = input.rule?.requiredApprovals ?? 0;
    if (required > 0) {
      const approvals = this.countApprovals(input.reviews, input.creatorEmail);
      if (approvals < required) {
        return { blocked: true, reason: `pull request requires ${required} approvals (${approvals} so far)` };
      }
    }
    const owners = (input.codeowners?.owners ?? []).map((o) => o.toLowerCase());
    if (owners.length > 0) {
      const creator = input.creatorEmail.toLowerCase();
      const latestByAuthor = new Map<string, string>();
      for (const review of input.reviews) {
        if (review.dismissed === 1) continue;
        latestByAuthor.set(review.author_email.toLowerCase(), review.state);
      }
      let ownerApproved = false;
      for (const [author, state] of latestByAuthor) {
        if (author !== creator && state === 'approved' && owners.includes(author)) {
          ownerApproved = true;
          break;
        }
      }
      if (!ownerApproved) {
        return { blocked: true, reason: 'pull request requires approval from a code owner' };
      }
    }
    return { blocked: false, reason: null };
  }

  public async listRules(repositoryId: string): Promise<BranchProtectionRuleMetadata[]> {
    const dao = await this.deps.branchProtectionDAO();
    return dao.listByRepo(repositoryId);
  }

  public async matchForRepo(repositoryId: string, branch: string): Promise<BranchProtectionRuleMetadata | null> {
    const rules = await this.listRules(repositoryId);
    return BranchProtectionService.matchRule(rules, branch);
  }

  public async createRule(input: {
    repositoryId: string;
    pattern: string;
    requirePr?: boolean;
    requiredApprovals?: number;
    blockForcePush?: boolean;
    blockDeletion?: boolean;
    requireStatusChecks?: unknown;
    createdBy: string;
  }): Promise<BranchProtectionRuleMetadata> {
    const pattern = input.pattern.trim();
    if (!isValidRulePattern(pattern)) {
      throw new BadRequestError('pattern must be 1-255 chars of letters, digits, `.`, `-`, `_`, `/`, `*` (no `..`, `//`, `**`)');
    }
    const requiredApprovals = input.requiredApprovals ?? 0;
    if (!Number.isSafeInteger(requiredApprovals) || requiredApprovals < 0 || requiredApprovals > MAX_REQUIRED_APPROVALS) {
      throw new BadRequestError(`requiredApprovals must be an integer 0-${MAX_REQUIRED_APPROVALS}`);
    }
    const statusChecks = parseStatusChecks(input.requireStatusChecks);
    const dao = await this.deps.branchProtectionDAO();
    const existing = await dao.getByRepoAndPattern(input.repositoryId, pattern);
    if (existing) throw new BadRequestError('a rule for this pattern already exists');
    const max = ConfigurationManager.repo.getMaxRulesPerRepo(this.env);
    const count = await dao.countByRepo(input.repositoryId);
    if (count >= max) throw new BadRequestError(`Maximum ${max} protection rules per repository`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    // Approvals only make sense on pull requests: requesting reviewers
    // without requiring a PR would deadlock every direct push.
    const requirePr = requiredApprovals > 0 ? true : (input.requirePr ?? false);
    await dao.create({
      id,
      repositoryId: input.repositoryId,
      pattern,
      requirePr,
      requiredApprovals,
      blockForcePush: input.blockForcePush ?? true,
      blockDeletion: input.blockDeletion ?? true,
      requireStatusChecks: statusChecks,
      createdBy: input.createdBy,
      now,
    });
    return {
      id,
      repositoryId: input.repositoryId,
      pattern,
      requirePr,
      requiredApprovals,
      blockForcePush: input.blockForcePush ?? true,
      blockDeletion: input.blockDeletion ?? true,
      requireStatusChecks: statusChecks,
      createdBy: input.createdBy.toLowerCase(),
      createdAt: now,
    };
  }

  public async deleteRule(repositoryId: string, ruleId: string): Promise<void> {
    const dao = await this.deps.branchProtectionDAO();
    await dao.delete(ruleId, repositoryId);
  }
}

function parseStatusChecks(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new BadRequestError('requireStatusChecks must be an array of strings');
  if (input.length > MAX_STATUS_CHECKS) throw new BadRequestError(`requireStatusChecks must have at most ${MAX_STATUS_CHECKS} entries`);
  const checks = input.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim().slice(0, 200));
  if (checks.length !== input.length) throw new BadRequestError('requireStatusChecks must be an array of non-empty strings');
  return checks;
}

export { BranchProtectionService, MAX_REQUIRED_APPROVALS };
export type { BranchProtectionServiceDeps, BranchProtectionServiceEnv };
