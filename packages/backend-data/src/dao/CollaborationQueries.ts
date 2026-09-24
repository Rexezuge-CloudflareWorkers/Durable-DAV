/**
 * Pure SQL builders for the collaboration read-model (Otter `*Queries.ts`
 * pattern). Keeps SQL strings out of `CollaborationDAO` methods so queries
 * are unit-testable without D1 and the DAO shrinks toward the god-file guard.
 */
const CollaborationQueries = {
  insertLabel(): string {
    return 'INSERT INTO labels (id, repository_id, name, color, description, created_at) VALUES (?, ?, ?, ?, ?, ?)';
  },
  listLabels(): string {
    return 'SELECT * FROM labels WHERE repository_id = ? ORDER BY name ASC';
  },
  insertMilestone(): string {
    return 'INSERT INTO milestones (id, repository_id, title, description, due_on, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
  },
  /**
   * Open-state milestone insert with the `'open'` literal inline (matches
   * `CollaborationDAO.createMilestone` exactly — 6 binds, no status param).
   */
  insertMilestoneOpen(): string {
    return "INSERT INTO milestones (id, repository_id, title, description, due_on, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)";
  },
  listMilestones(): string {
    return 'SELECT * FROM milestones WHERE repository_id = ? ORDER BY created_at DESC';
  },
  upsertReviewer(): string {
    return 'INSERT INTO pull_reviewers (pull_request_id, user_email, status, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(pull_request_id, user_email) DO UPDATE SET status = excluded.status';
  },
  listReviewers(): string {
    return 'SELECT * FROM pull_reviewers WHERE pull_request_id = ? ORDER BY created_at ASC';
  },
  /**
   * Re-request path: `INSERT OR IGNORE` keeps an existing review state
   * (differs from `upsertReviewer`, which overwrites status on conflict).
   */
  insertReviewerIgnore(): string {
    return "INSERT OR IGNORE INTO pull_reviewers (pull_request_id, user_email, status, created_at) VALUES (?, ?, 'pending', ?)";
  },
  /**
   * Reviewer listing in email order (matches `CollaborationDAO.listReviewers`;
   * differs from `listReviewers`, which orders by creation time).
   */
  listReviewersByEmail(): string {
    return 'SELECT * FROM pull_reviewers WHERE pull_request_id = ? ORDER BY user_email ASC';
  },
} as const;

/**
 * Pure repository maintenance helpers (Otter `RepositoryHelper` pattern).
 * Batching + cutoff math lives here so DAOs and cron tasks share one
 * implementation instead of duplicating `LIMIT ?` / date logic.
 */
const DEFAULT_PRUNE_BATCH_SIZE = 500;

function computeUnixCutoffSeconds(nowSeconds: number, retentionDays: number): number {
  return nowSeconds - retentionDays * 86_400;
}

function computeDateCutoffIso(now: Date, retentionDays: number): string {
  return new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
}

async function pruneInBatches(pruneBatch: (limit: number) => Promise<number>, batchSize = DEFAULT_PRUNE_BATCH_SIZE): Promise<number> {
  let total = 0;
  for (;;) {
    const pruned = await pruneBatch(batchSize);
    total += pruned;
    if (pruned < batchSize) break;
  }
  return total;
}

export { CollaborationQueries, DEFAULT_PRUNE_BATCH_SIZE, computeUnixCutoffSeconds, computeDateCutoffIso, pruneInBatches };
