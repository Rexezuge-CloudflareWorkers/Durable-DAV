import { describe, expect, it } from 'vitest';
import { VolumeReplicationService } from '../packages/backend-services/src/dav/VolumeReplicationService';
import { generateReplicationKey } from '../packages/backend-data/src/crypto/replicationKey';
import { AppConfiguration } from '../packages/backend-runtime/src/config/AppConfiguration';
import type { DavReplicationRow } from '../packages/backend-data/src/dao/DavReplicationDAO';
import type { DavReplicationConflictRow } from '../packages/backend-data/src/dao/DavReplicationConflictDAO';

/**
 * `VolumeReplicationService`'s read/update/delete paths, over fake DAOs.
 *
 * The method that matters most here is the scope check: every read is resolved
 * through `requireReplication`, which matches the row's `volume_id` against the
 * caller's rather than looking the id up alone. A replication id is a guessable
 * string, and a target URL is an internal hostname on the deployments that use
 * this feature — so an unscoped read hands a caller a map of private
 * infrastructure. `getReplication`, `updateReplication`, `deleteReplication`,
 * `listConflicts`, `resolveConflict` and `countUnresolvedConflicts` all go
 * through it, and each of the "another volume" cases below fails closed.
 */

function row(overrides: Partial<DavReplicationRow> = {}): DavReplicationRow {
  return {
    replication_id: 'rep_1',
    volume_id: 'vol_1',
    target_kind: 'dav',
    remote_url: 'https://remote.example.com/dav',
    remote_owner: '',
    remote_volume: '',
    remote_path: 'docs',
    auth_kind: 'basic',
    encrypted_secret: 'sealed',
    secret_iv: 'iv',
    mode: 'copy-only',
    mirror_deletions: 0,
    interval_minutes: 60,
    enabled: 1,
    last_run_at: null,
    last_status: null,
    last_error: null,
    consecutive_failures: 0,
    cursor_path: null,
    cursor_remaining: 0,
    pass_started_at: null,
    created_at: 1,
    updated_at: 1,
    created_by: 'owner@example.com',
    ...overrides,
  };
}

function conflict(overrides: Partial<DavReplicationConflictRow> = {}): DavReplicationConflictRow {
  return {
    conflict_id: 'cf_1',
    replication_id: 'rep_1',
    path: 'docs/readme.md',
    winner: 'local',
    kept_path: 'docs/readme.md.conflict-1',
    kind: 'conflict',
    detected_at: 1,
    resolved_at: null,
    ...overrides,
  };
}

interface Fakes {
  replication: {
    rows: DavReplicationRow[];
    updates: Array<{ id: string; patch: Record<string, unknown> }>;
    deleted: string[];
  };
  conflicts: {
    rows: DavReplicationConflictRow[];
    resolved: Array<{ replicationId: string; conflictId: string; now: number }>;
  };
  service: VolumeReplicationService;
}

function serviceWith(
  overrides: {
    replications?: DavReplicationRow[];
    conflicts?: DavReplicationConflictRow[];
    allowedHosts?: string[];
  } = {},
): Fakes {
  const fakes: Fakes = {
    replication: { rows: overrides.replications ?? [], updates: [], deleted: [] },
    conflicts: { rows: overrides.conflicts ?? [], resolved: [] },
    service: undefined as never,
  };
  fakes.service = new VolumeReplicationService(
    { DB: {} as never, REPLICATION_ENCRYPTION_KEY: generateReplicationKey() },
    {
      replicationDAO: () =>
        Promise.resolve({
          listByVolume: async (volumeId: string) => fakes.replication.rows.filter((r) => r.volume_id === volumeId),
          getById: async (id: string) => fakes.replication.rows.find((r) => r.replication_id === id),
          update: async (id: string, patch: Record<string, unknown>) => {
            // The camelCase-to-column translation the real DAO's `update` does:
            // the service builds the patch in TS field names and the DAO maps
            // each present field onto its column, `mirrorDeletions`/`enabled`
            // through the boolean coercion SQLite needs.
            fakes.replication.updates.push({ id, patch });
            const target = fakes.replication.rows.find((r) => r.replication_id === id);
            if (!target) return;
            if (patch.mode !== undefined) target.mode = patch.mode as string;
            if (patch.mirrorDeletions !== undefined) target.mirror_deletions = patch.mirrorDeletions ? 1 : 0;
            if (patch.intervalMinutes !== undefined) target.interval_minutes = patch.intervalMinutes as number;
            if (patch.enabled !== undefined) target.enabled = patch.enabled ? 1 : 0;
            target.updated_at = patch.now as number;
          },
          deleteById: async (id: string) => {
            fakes.replication.deleted.push(id);
          },
        } as never),
      conflictDAO: () =>
        Promise.resolve({
          listByReplication: async (replicationId: string, includeResolved: boolean) =>
            fakes.conflicts.rows.filter((c) => c.replication_id === replicationId && (includeResolved || c.resolved_at === null)),
          markResolved: async (replicationId: string, conflictId: string, now: number) => {
            fakes.conflicts.resolved.push({ replicationId, conflictId, now });
            return true;
          },
          countUnresolved: async (replicationId: string) =>
            fakes.conflicts.rows.filter((c) => c.replication_id === replicationId && c.resolved_at === null).length,
        } as never),
      // The egress allowlist is configuration, never the request body; the
      // config is injected so a test can see the service read it from there.
      config: AppConfiguration.fromEnv(overrides.allowedHosts ? { REPLICATION_ALLOWED_HOSTS: overrides.allowedHosts.join(',') } : {}),
    },
  );
  return fakes;
}

describe('VolumeReplicationService reads', () => {
  it("lists a volume's replications", async () => {
    const fakes = serviceWith({
      replications: [row(), row({ replication_id: 'rep_2', volume_id: 'vol_1' }), row({ replication_id: 'rep_9', volume_id: 'vol_other' })],
    });

    await expect(fakes.service.listReplications('vol_1')).resolves.toHaveLength(2);
  });

  it('refuses a replication that belongs to another volume', async () => {
    // The scope, not the id: the response would otherwise carry another
    // bucket's target URL and its last error.
    const fakes = serviceWith({ replications: [row({ volume_id: 'vol_other' })] });

    await expect(fakes.service.getReplication('vol_1', 'rep_1')).rejects.toThrow(/not found/i);
    await expect(fakes.service.deleteReplication('vol_1', 'rep_1')).rejects.toThrow(/not found/i);
    await expect(fakes.service.listConflicts('vol_1', 'rep_1', true)).rejects.toThrow(/not found/i);
    await expect(fakes.service.countUnresolvedConflicts('vol_1', 'rep_1')).rejects.toThrow(/not found/i);
    // Nothing was written on the refused paths.
    expect(fakes.replication.deleted).toEqual([]);
  });

  it("reads a replication inside the caller's volume", async () => {
    const fakes = serviceWith({ replications: [row()] });

    await expect(fakes.service.getReplication('vol_1', 'rep_1')).resolves.toMatchObject({
      replication_id: 'rep_1',
      remote_url: 'https://remote.example.com/dav',
    });
  });
});

describe('VolumeReplicationService writes', () => {
  it('applies a patch and reads the row back', async () => {
    const fakes = serviceWith({ replications: [row()] });

    const updated = await fakes.service.updateReplication('vol_1', 'rep_1', { intervalMinutes: 15, enabled: false });

    expect(fakes.replication.updates).toHaveLength(1);
    expect(updated.interval_minutes).toBe(15);
    expect(updated.enabled).toBe(0);
  });

  it('clears mirror_deletions when a replication moves off pull-only', async () => {
    // A set flag on a mode that cannot read it is a behaviour that appears
    // switched off but silently re-arms when the owner switches back.
    const fakes = serviceWith({ replications: [row({ mode: 'pull-only', mirror_deletions: 1 })] });

    const updated = await fakes.service.updateReplication('vol_1', 'rep_1', { mode: 'sync' });

    expect(updated.mode).toBe('sync');
    expect(updated.mirror_deletions).toBe(0);
  });

  it("deletes a replication inside the caller's volume", async () => {
    const fakes = serviceWith({ replications: [row()] });

    await expect(fakes.service.deleteReplication('vol_1', 'rep_1')).resolves.toBeUndefined();
    expect(fakes.replication.deleted).toEqual(['rep_1']);
  });

  it("lists and resolves a replication's conflicts", async () => {
    const fakes = serviceWith({
      replications: [row()],
      conflicts: [conflict(), conflict({ conflict_id: 'cf_2', resolved_at: 5 })],
    });

    await expect(fakes.service.listConflicts('vol_1', 'rep_1', false)).resolves.toHaveLength(1);
    await expect(fakes.service.listConflicts('vol_1', 'rep_1', true)).resolves.toHaveLength(2);
    await expect(fakes.service.countUnresolvedConflicts('vol_1', 'rep_1')).resolves.toBe(1);
    await expect(fakes.service.resolveConflict('vol_1', 'rep_1', 'cf_1')).resolves.toBe(true);
    expect(fakes.conflicts.resolved).toHaveLength(1);
  });
});
