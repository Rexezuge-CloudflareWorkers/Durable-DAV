import { describe, expect, it } from 'vitest';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { generateAESGCMKey } from '@duradav/backend-data/crypto/aes-gcm';
import { ImportDAO } from '@duradav/backend-data/dao/ImportDAO';
import { MirrorDAO } from '@duradav/backend-data/dao/MirrorDAO';
import { WebhookDAO } from '@duradav/backend-data/dao/WebhookDAO';

// Minimal in-memory D1 fake covering the envelope-only SQL shapes since
// 0027 (no plaintext `secret`/`source_url` columns): envelope INSERTs/UPSERTs
// plus SELECTs returning stored rows verbatim.
function createEncryptedFakeDb() {
  const state = {
    hooks: [] as Array<Record<string, unknown>>,
    hookEvents: [] as Array<{ hook_id: string; event: string }>,
    mirrors: [] as Array<Record<string, unknown>>,
    imports: [] as Array<Record<string, unknown>>,
  };

  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.includes('FROM repo_webhooks WHERE id = ? AND repository_id = ?')) {
          return Promise.resolve((state.hooks.find((h) => h.id === params[0] && h.repository_id === params[1]) ?? null) as T | null);
        }
        if (q.includes('FROM repo_mirrors WHERE repository_id = ?')) {
          return Promise.resolve((state.mirrors.find((m) => m.repository_id === params[0]) ?? null) as T | null);
        }
        if (q.includes('FROM repo_imports WHERE id = ?')) {
          return Promise.resolve((state.imports.find((i) => i.id === params[0]) ?? null) as T | null);
        }
        if (q.includes('FROM repo_imports WHERE repository_id = ? ORDER BY')) {
          const rows = state.imports
            .filter((i) => i.repository_id === params[0])
            .sort((a, b) => (b.created_at as number) - (a.created_at as number) || String(b.id).localeCompare(String(a.id)));
          return Promise.resolve((rows[0] ?? null) as T | null);
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.includes('FROM repo_webhooks WHERE repository_id = ?')) {
          return Promise.resolve({ results: state.hooks.filter((h) => h.repository_id === params[0]) as T[] });
        }
        if (q.includes('SELECT event FROM webhook_events WHERE hook_id = ?')) {
          return Promise.resolve({ results: state.hookEvents.filter((e) => e.hook_id === params[0]).map((e) => ({ event: e.event })) as T[] });
        }
        if (q.includes('FROM repo_mirrors WHERE enabled = 1')) {
          return Promise.resolve({ results: state.mirrors.filter((m) => m.enabled === 1) as T[] });
        }
        if (q.includes("FROM repo_imports WHERE status = 'pending'")) {
          return Promise.resolve({ results: state.imports.filter((i) => i.status === 'pending') as T[] });
        }
        return Promise.resolve({ results: [] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
        if (q.startsWith('INSERT INTO repo_webhooks')) {
          const [id, repository_id, url, url_prefix, secret_suffix, creator_email, created_at, updated_at] =
            params as Array<string | number>;
          state.hooks.push({
            id,
            repository_id,
            url,
            url_prefix,
            secret_suffix,
            encrypted_secret: params[8] as string,
            secret_iv: params[9] as string,
            is_active: 1,
            consecutive_failures: 0,
            last_delivery_at: null,
            last_delivery_status: null,
            creator_email,
            created_at,
            updated_at,
          });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE repo_webhooks SET secret_suffix = ?')) {
          const [secret_suffix, now, encrypted_secret, secret_iv, id] = params as [string, number, string, string, string];
          const hook = state.hooks.find((h) => h.id === id);
          if (hook) {
            hook.secret_suffix = secret_suffix;
            hook.updated_at = now;
            hook.encrypted_secret = encrypted_secret;
            hook.secret_iv = secret_iv;
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM webhook_events WHERE hook_id = ?')) {
          state.hookEvents = state.hookEvents.filter((e) => e.hook_id !== params[0]);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT OR IGNORE INTO webhook_events')) {
          const [hook_id, event] = params as [string, string];
          if (!state.hookEvents.some((e) => e.hook_id === hook_id && e.event === event)) state.hookEvents.push({ hook_id, event });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO repo_mirrors')) {
          const [repository_id, interval_minutes, created_by, created_at, updated_at] = params as Array<string | number>;
          const row = {
            repository_id,
            encrypted_source_url: params[5] as string,
            source_url_iv: params[6] as string,
            interval_minutes,
            enabled: 1,
            last_run_at: null,
            last_status: null,
            last_error: null,
            consecutive_failures: 0,
            created_by,
            created_at,
            updated_at,
          };
          const existing = state.mirrors.findIndex((m) => m.repository_id === repository_id);
          if (existing >= 0) state.mirrors[existing] = { ...state.mirrors[existing], ...row };
          else state.mirrors.push(row);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO repo_imports')) {
          const [id, repository_id, status, created_by, created_at, updated_at] = params as Array<string | number>;
          state.imports.push({
            id,
            repository_id,
            encrypted_source_url: params[6] as string,
            source_url_iv: params[7] as string,
            status,
            error: null,
            imported_refs: 0,
            created_by,
            created_at,
            updated_at,
          });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.includes("UPDATE repo_imports SET status = 'running'")) {
          const row = state.imports.find((i) => i.id === params[1]);
          if (row) {
            row.status = 'running';
            row.updated_at = params[0] as number;
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        return Promise.resolve({ success: true, meta: { changes: 0 } });
      },
    };
  }

  const db = {
    prepare(query: string) {
      return { bind: (...params: unknown[]) => statement(query, params) };
    },
  };
  return { db: db as unknown as D1Queryable, state };
}

describe('per-feature encrypted secrets at rest', () => {
  it('webhook DAO stores only the envelope and decrypts on read', async () => {
    const { db, state } = createEncryptedFakeDb();
    const key = await generateAESGCMKey();
    const dao = new WebhookDAO(db, key);
    await dao.create({
      id: 'hook-1',
      repositoryId: 'repo-1',
      url: 'https://hooks.example.com/hook',
      urlPrefix: 'https://hooks.example.com/ho',
      secret: 'super-secret-value',
      secretSuffix: 'alue',
      events: ['push'],
      creatorEmail: 'alice@example.com',
      now: 1_700_000_000,
    });
    const stored = state.hooks[0];
    expect(stored).not.toHaveProperty('secret');
    expect(stored.encrypted_secret).toBeTruthy();
    expect(stored.encrypted_secret).not.toBe('super-secret-value');
    const row = await dao.getByIdAndRepo('hook-1', 'repo-1');
    expect(row?.secret).toBe('super-secret-value');
    await dao.rotateSecret('hook-1', 'repo-1', 'rotated-secret', 'cret', 1_700_000_001);
    await expect(dao.getByIdAndRepo('hook-1', 'repo-1').then((r) => r?.secret)).resolves.toBe('rotated-secret');
  });

  it('mirror and import DAOs encrypt source URLs with their own keys', async () => {
    const { db } = createEncryptedFakeDb();
    const mirrorKey = await generateAESGCMKey();
    const importKey = await generateAESGCMKey();
    const mirrors = new MirrorDAO(db, mirrorKey);
    const imports = new ImportDAO(db, importKey);
    await mirrors.upsert({ repositoryId: 'repo-1', sourceUrl: 'https://github.com/o/r.git', intervalMinutes: 1440, createdBy: 'a@x.com', now: 1 });
    await imports.create({ id: 'job-1', repositoryId: 'repo-1', sourceUrl: 'https://github.com/o/s.git', createdBy: 'a@x.com', now: 1 });
    await expect(mirrors.getByRepo('repo-1').then((r) => r?.source_url)).resolves.toBe('https://github.com/o/r.git');
    await expect(imports.getById('job-1').then((r) => r?.source_url)).resolves.toBe('https://github.com/o/s.git');
    await expect(imports.latestByRepo('repo-1').then((r) => r?.source_url)).resolves.toBe('https://github.com/o/s.git');
  });

  it('fails closed on a wrong key or a missing envelope', async () => {
    const { db, state } = createEncryptedFakeDb();
    const dao = new WebhookDAO(db, await generateAESGCMKey());
    await dao.create({
      id: 'hook-1',
      repositoryId: 'repo-1',
      url: 'https://hooks.example.com/hook',
      urlPrefix: 'https://hooks.example.com/ho',
      secret: 's3cret',
      secretSuffix: 'cret',
      events: ['push'],
      creatorEmail: 'alice@example.com',
      now: 1,
    });
    const wrongKey = new WebhookDAO(db, await generateAESGCMKey());
    await expect(wrongKey.getByIdAndRepo('hook-1', 'repo-1')).rejects.toThrow();
    state.hooks.push({
      id: 'bare',
      repository_id: 'repo-1',
      url: 'https://hooks.example.com/bare',
      url_prefix: 'https://hooks.example.com/ba',
      secret_suffix: 'bare',
      encrypted_secret: null,
      secret_iv: null,
      is_active: 1,
      consecutive_failures: 0,
      last_delivery_at: null,
      last_delivery_status: null,
      creator_email: 'alice@example.com',
      created_at: 1,
      updated_at: 1,
    });
    await expect(dao.getByIdAndRepo('bare', 'repo-1')).rejects.toThrow('envelope is missing');
  });
});
