import { BaseDAO } from '@rexezuge/d1';
import type { D1Queryable } from '@rexezuge/d1';

export interface DavReplicationConflictRow {
  conflict_id: string;
  replication_id: string;
  path: string;
  winner: string;
  kept_path: string | null;
  kind: string;
  detected_at: number;
  resolved_at: number | null;
}

/**
 * The audit trail for every destructive or ambiguous decision a sync made.
 *
 * Two kinds, and the second is why this table exists at all: a two-way sync
 * that deletes on *both* sides is the most dangerous thing this codebase does,
 * and once a deletion has propagated there is no undo. Recording every one
 * turns "the file is gone" from an archaeology problem into a lookup.
 */
class DavReplicationConflictDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async record(input: {
    conflictId: string;
    replicationId: string;
    path: string;
    winner: 'local' | 'remote';
    keptPath: string | null;
    kind: 'conflict' | 'deletion';
    now: number;
  }): Promise<void> {
    await this.run(
      'INSERT INTO dav_replication_conflicts (conflict_id, replication_id, path, winner, kept_path, kind, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [input.conflictId, input.replicationId, input.path, input.winner, input.keptPath, input.kind, input.now],
    );
  }

  public async listByReplication(replicationId: string, includeResolved: boolean, limit = 200): Promise<DavReplicationConflictRow[]> {
    return this.all<DavReplicationConflictRow>(
      `SELECT * FROM dav_replication_conflicts
             WHERE replication_id = ? ${includeResolved ? '' : 'AND resolved_at IS NULL'}
             ORDER BY detected_at DESC LIMIT ?`,
      [replicationId, limit],
    );
  }

  public async countUnresolved(replicationId: string): Promise<number> {
    const row = await this.first<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM dav_replication_conflicts WHERE replication_id = ? AND resolved_at IS NULL',
      [replicationId],
    );
    return row?.cnt ?? 0;
  }

  /**
   * Mark resolved.
   *
   * Guarded on `resolved_at IS NULL` so resolving twice is idempotent rather
   * than the second call silently rewriting when it was first handled — the
   * caller has already pushed a side by then, and doing that twice would write
   * the same bytes over a file a user may have edited since.
   */
  public async markResolved(replicationId: string, conflictId: string, now: number): Promise<boolean> {
    const result = await this.run(
      'UPDATE dav_replication_conflicts SET resolved_at = ? WHERE conflict_id = ? AND replication_id = ? AND resolved_at IS NULL',
      [now, conflictId, replicationId],
    );
    return (result.meta?.changes ?? 0) > 0;
  }
}

export { DavReplicationConflictDAO };
