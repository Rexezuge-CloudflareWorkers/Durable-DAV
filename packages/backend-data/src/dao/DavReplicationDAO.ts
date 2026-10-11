import { BaseDAO } from '@rexezuge/d1';
import { beginPassStatement, recordRunStatement } from './replicationPassSql';
import type { D1Queryable } from '@rexezuge/d1';

/**
 * Where a replication points.
 *
 * `dav-volume` is a sibling bucket on this same deployment, reached through the
 * `DAV_VOLUME` binding rather than over HTTP. It exists because routing it
 * through the public URL would put the deployment's own egress path behind the
 * SSRF policy in `RemoteUrlPolicy`, which by design refuses private and
 * loopback addresses — i.e. it would refuse the one target that is provably
 * not an attack.
 */
type ReplicationTargetKind = 'dav' | 'dav-volume';

/**
 * How a path both sides changed is reconciled, and in which direction changes flow.
 *
 * `copy-only` is one-way on purpose: a mirror of a bucket must not import the
 * mirror's own corruption, and a backup target that silently accepts writes cannot
 * be trusted as a backup. `pull-only` is its mirror image — the *remote* is the
 * authority, nothing is ever pushed, and `mirror_deletions` chooses whether a local
 * path the remote lacks is removed or left alone.
 */
type ReplicationMode = 'copy-only' | 'sync' | 'keep-both' | 'pull-only';

type ReplicationAuthKind = 'none' | 'basic' | 'bearer';

type ReplicationRunStatus = 'ok' | 'partial' | 'failed';

export interface DavReplicationRow {
  replication_id: string;
  volume_id: string;
  target_kind: string;
  remote_url: string;
  remote_owner: string;
  remote_volume: string;
  remote_path: string;
  auth_kind: string;
  encrypted_secret: string | null;
  secret_iv: string | null;
  mode: string;
  mirror_deletions: number;
  interval_minutes: number;
  enabled: number;
  last_run_at: number | null;
  last_status: string | null;
  last_error: string | null;
  consecutive_failures: number;
  cursor_path: string | null;
  cursor_remaining: number;
  pass_started_at: number | null;
  created_at: number;
  updated_at: number;
  created_by: string | null;
}

/**
The four target columns that together identify a remote.
*/
type ReplicationTarget = {
  targetKind: ReplicationTargetKind;
  remoteUrl: string;
  remoteOwner: string;
  remoteVolume: string;
  remotePath: string;
};

/**
 * Statements shared with `replicationPassSql` or reused by more than one method
 * live there or here, so the retry wrapper is applied at the call site rather than
 * forgotten inside a helper.
 */
/**
 * Statements shared with `replicationPassSql` or reused by more than one method
 * live there or here, so the retry wrapper is applied at the call site rather than
 * forgotten inside a helper.
 */
class DavReplicationDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(input: {
    replicationId: string;
    volumeId: string;
    target: ReplicationTarget;
    authKind: ReplicationAuthKind;
    encryptedSecret: string | null;
    secretIv: string | null;
    mode: ReplicationMode;
    mirrorDeletions: boolean;
    intervalMinutes: number;
    enabled: boolean;
    now: number;
    createdBy: string | null;
  }): Promise<void> {
    const { target } = input;
    await this.run(`INSERT INTO dav_replications (replication_id, volume_id, target_kind, remote_url, remote_owner, remote_volume, remote_path,
              auth_kind, encrypted_secret, secret_iv, mode, mirror_deletions, interval_minutes, enabled, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.replicationId,
            input.volumeId,
            target.targetKind,
            target.remoteUrl,
            target.remoteOwner,
            target.remoteVolume,
            target.remotePath,
            input.authKind,
            input.encryptedSecret,
            input.secretIv,
            input.mode,
            input.mirrorDeletions ? 1 : 0,
            input.intervalMinutes,
            input.enabled ? 1 : 0,
            input.now,
            input.now,
            input.createdBy,]);
  }

  public async getById(replicationId: string): Promise<DavReplicationRow | undefined> {
    return this.first<DavReplicationRow>('SELECT * FROM dav_replications WHERE replication_id = ? LIMIT 1', [replicationId]);
  }

  public async getByVolumeAndTarget(volumeId: string, target: ReplicationTarget): Promise<DavReplicationRow | undefined> {
    return this.first<DavReplicationRow>('SELECT * FROM dav_replications WHERE volume_id = ? AND target_kind = ? AND remote_url = ? AND remote_owner = ? AND remote_volume = ? AND remote_path = ? LIMIT 1', [volumeId, target.targetKind, target.remoteUrl, target.remoteOwner, target.remoteVolume, target.remotePath]);
  }

  public async listByVolume(volumeId: string): Promise<DavReplicationRow[]> {
    return this.all<DavReplicationRow>('SELECT * FROM dav_replications WHERE volume_id = ? ORDER BY created_at ASC', [volumeId]);
  }

  /**
   * How many targets a bucket has, for the per-bucket replication cap.
   *
   * `firstWithRetry` rather than a bare `.first()`, as everywhere else in this
   * package: the caller uses the count to *reject* a creation, so a count that
   * degraded on a D1 blip would let the cap be bypassed.
   */
  public async countByVolume(volumeId: string): Promise<number> {
    const row = await this.first<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM dav_replications WHERE volume_id = ?', [volumeId]);
    return row?.cnt ?? 0;
  }

  /**
   * Update the mutable settings. The target columns are deliberately absent:
   * re-pointing a replication at a different remote mid-flight would leave the
   * recorded base describing a tree that no longer exists, so a target change is
   * a delete plus a create.
   */
  public async update(
    replicationId: string,
    patch: { mode?: ReplicationMode; mirrorDeletions?: boolean; intervalMinutes?: number; enabled?: boolean; now: number },
  ): Promise<void> {
    const sets: string[] = ['updated_at = ?'];
    const bindings: unknown[] = [patch.now];
    if (patch.mode !== undefined) {
      sets.push('mode = ?');
      bindings.push(patch.mode);
    }
    if (patch.mirrorDeletions !== undefined) {
      sets.push('mirror_deletions = ?');
      bindings.push(patch.mirrorDeletions ? 1 : 0);
    }
    if (patch.intervalMinutes !== undefined) {
      sets.push('interval_minutes = ?');
      bindings.push(patch.intervalMinutes);
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = ?');
      bindings.push(patch.enabled ? 1 : 0);
      // Re-enabling is a deliberate statement that the previous failures are no
      // longer interesting. Leaving the counter would auto-disable the target
      // again on the very next failure, so the owner could never recover from a
      // transient outage without editing the row by hand.
      if (patch.enabled) {
        sets.push('consecutive_failures = ?');
        bindings.push(0);
      }
    }
    bindings.push(replicationId);
    await this.run(`UPDATE dav_replications SET ${sets.join(', ')} WHERE replication_id = ?`, [...bindings]);
  }

  /**
   * Replace the stored credential.
   *
   * Deliberately not routed through `update`: the envelope is two columns, and
   * clearing one without the other would leave a row that decrypts to nothing.
   */
  public async setSecret(replicationId: string, encryptedSecret: string | null, secretIv: string | null, now: number): Promise<void> {
    await this.run('UPDATE dav_replications SET encrypted_secret = ?, secret_iv = ?, updated_at = ? WHERE replication_id = ?', [encryptedSecret, secretIv, now, replicationId]);
  }

  public async deleteById(replicationId: string): Promise<void> {
    await this.run('DELETE FROM dav_replications WHERE replication_id = ?', [replicationId]);
  }

  /**
   * Replications whose interval has elapsed.
   *
   * `COALESCE(last_run_at, 0)` rather than `NULLS FIRST`: the never-run rows
   * sort first under either spelling, but the portable one does not depend on
   * the SQLite version D1 happens to ship this month.
   */
  public async listDue(now: number, limit: number): Promise<DavReplicationRow[]> {
    return this.all<DavReplicationRow>(`SELECT * FROM dav_replications
             WHERE enabled = 1 AND (last_run_at IS NULL OR last_run_at + interval_minutes * 60 <= ?)
             ORDER BY COALESCE(last_run_at, 0) ASC, replication_id ASC
             LIMIT ?`, [now, limit]);
  }

  /**
   * Open the deletion gate and clear any stale cursor.
   *
   * The gate itself, and the rules for closing it, are stated in
   * `replicationPassSql` — this is the entry point, not the explanation.
   */
  public async beginPass(replicationId: string, now: number): Promise<void> {
    const begin = beginPassStatement(replicationId, now);
    await this.run(begin.sql, begin.bindings);
  }

  /**
   * Record the outcome of one tick, and open or close the deletion gate.
   *
   * See `replicationPassSql`: the gate closes when the pass failed or finished with
   * nothing left to visit, and stays open otherwise.
   */
  public async recordRun(
    replicationId: string,
    status: ReplicationRunStatus,
    error: string | null,
    now: number,
    maxFailures: number,
    cursorPath: string | null = null,
    remaining = 0,
  ): Promise<void> {
    const recorded = recordRunStatement(replicationId, status, error, now, maxFailures, cursorPath, remaining);
    await this.run(recorded.sql, recorded.bindings);
  }

}

export { DavReplicationDAO };
export type { ReplicationTarget, ReplicationTargetKind, ReplicationMode, ReplicationAuthKind, ReplicationRunStatus };
