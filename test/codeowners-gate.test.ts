import { describe, expect, it } from 'vitest';
import { normalizeCodeownerHandle } from '@duradav/backend-services/collab';
import { BranchProtectionService } from '@duradav/backend-services/protection';

describe('normalizeCodeownerHandle', () => {
  it('strips @ and rejects teams and malformed tokens', () => {
    expect(normalizeCodeownerHandle('@alice')).toBe('alice');
    expect(normalizeCodeownerHandle('bob')).toBe('bob');
    expect(normalizeCodeownerHandle('org/team')).toBeNull();
    expect(normalizeCodeownerHandle('@org/team')).toBeNull();
    expect(normalizeCodeownerHandle('')).toBeNull();
    expect(normalizeCodeownerHandle('has space')).toBeNull();
  });
});

describe('BranchProtectionService CODEOWNERS quorum', () => {
  const creator = 'alice@example.com';
  const ownerApproval = [
    { author_email: 'carol@example.com', state: 'approved' },
    { author_email: creator, state: 'commented' },
  ];

  it('does not block when no owners resolve', () => {
    const gate = BranchProtectionService.checkMergeBlocked({ rule: null, reviews: [], creatorEmail: creator, codeowners: { owners: [] } });
    expect(gate.blocked).toBe(false);
  });

  it('blocks until a non-creator owner approves', () => {
    const owners = ['carol@example.com'];
    expect(
      BranchProtectionService.checkMergeBlocked({ rule: null, reviews: [], creatorEmail: creator, codeowners: { owners } }).blocked,
    ).toBe(true);
    expect(
      BranchProtectionService.checkMergeBlocked({ rule: null, reviews: ownerApproval, creatorEmail: creator, codeowners: { owners } })
        .blocked,
    ).toBe(false);
  });

  it('ignores creator self-approval and dismissed owner approvals', () => {
    const owners = ['alice@example.com'];
    const selfApproval = [{ author_email: creator, state: 'approved' }];
    expect(
      BranchProtectionService.checkMergeBlocked({ rule: null, reviews: selfApproval, creatorEmail: creator, codeowners: { owners } })
        .blocked,
    ).toBe(true);

    const dismissed = [{ author_email: 'carol@example.com', state: 'approved', dismissed: 1 }];
    expect(
      BranchProtectionService.checkMergeBlocked({
        rule: null,
        reviews: dismissed,
        creatorEmail: creator,
        codeowners: { owners: ['carol@example.com'] },
      }).blocked,
    ).toBe(true);
  });

  it('still vetoes on changes_requested even with owner approval', () => {
    const reviews = [...ownerApproval, { author_email: 'dave@example.com', state: 'changes_requested' }];
    const gate = BranchProtectionService.checkMergeBlocked({
      rule: null,
      reviews,
      creatorEmail: creator,
      codeowners: { owners: ['carol@example.com'] },
    });
    expect(gate).toMatchObject({ blocked: true, reason: 'pull request has unresolved change requests' });
  });

  it('combines with the approval quorum', () => {
    const rule = { requiredApprovals: 2 } as unknown as Parameters<typeof BranchProtectionService.checkMergeBlocked>[0]['rule'];
    const gate = BranchProtectionService.checkMergeBlocked({
      rule,
      reviews: ownerApproval,
      creatorEmail: creator,
      codeowners: { owners: ['carol@example.com'] },
    });
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toContain('requires 2 approvals');
  });
});

describe('approval counting skips dismissed reviews', () => {
  it('counts only live approvals', () => {
    const reviews = [
      { author_email: 'bob@example.com', state: 'approved', dismissed: 1 },
      { author_email: 'carol@example.com', state: 'approved' },
    ];
    expect(BranchProtectionService.countApprovals(reviews, 'alice@example.com')).toBe(1);
    expect(BranchProtectionService.countApprovals(reviews, 'carol@example.com')).toBe(0);
  });
});
