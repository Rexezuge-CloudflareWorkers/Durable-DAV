/**
 * Pure pull-request review gate (Otter `DigestSectionBuilder` pattern).
 *
 * Extracted from `PullRequestService` so the merge-block rule is unit
 * testable without D1. List order is oldest-first: the last entry per
 * author wins (same-second reviews share `created_at`, making timestamp
 * comparison unreliable). Dismissed reviews never block.
 */
interface ReviewGateInput {
  author_email: string;
  state: string;
  dismissed?: number | null;
}

function isDismissed(review: ReviewGateInput): boolean {
  return review.dismissed === 1;
}

function isBlockedByReviews(reviews: ReviewGateInput[]): boolean {
  const latestByAuthor = new Map<string, ReviewGateInput>();
  for (const review of reviews) {
    if (isDismissed(review)) continue;
    latestByAuthor.set(review.author_email.toLowerCase(), review);
  }
  for (const review of latestByAuthor.values()) {
    if (review.state === 'changes_requested') return true;
  }
  return false;
}

export { isBlockedByReviews, isDismissed };
export type { ReviewGateInput };
