import { DatabaseError } from '@duradav/backend-errors';
import { decryptData, encryptData } from '../crypto/aes-gcm';
import type { D1Queryable } from '../utils/D1Types';
import { EncryptedDAO } from './BaseDAO';

interface RepoWebhookRow {
  id: string;
  repository_id: string;
  // Computed `full_name` alias (`repositories` join) — the stored copy was
  // dropped in 0024; never written, only selected.
  full_name: string;
  url: string;
  url_prefix: string;
  // Decrypted HMAC secret (output only, never a stored column since 0027
  // dropped the plaintext `secret` column). Envelope lives in
  // `encrypted_secret`/`secret_iv` under `WEBHOOK_ENCRYPTION_KEY_SECRET`.
  secret: string;
  encrypted_secret: string;
  secret_iv: string;
  secret_suffix: string;
  is_active: number;
  consecutive_failures: number;
  last_delivery_at: number | null;
  last_delivery_status: string | null;
  creator_email: string;
  created_at: number;
  updated_at: number;
}

class WebhookDAO extends EncryptedDAO {
  constructor(database: D1Queryable, masterKey: string) {
    super(database, masterKey);
  }

  private async resolveSecret(row: RepoWebhookRow): Promise<string> {
    if (!this.masterKey) throw new DatabaseError('Webhook encryption key is not configured for this scope.');
    if (!row.encrypted_secret || !row.secret_iv) throw new DatabaseError('Webhook secret envelope is missing.');
    try {
      return await decryptData(row.encrypted_secret, row.secret_iv, this.masterKey);
    } catch (error) {
      throw new DatabaseError(`Failed to decrypt webhook secret: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private async withDecryptedSecret(rows: RepoWebhookRow[]): Promise<RepoWebhookRow[]> {
    const out: RepoWebhookRow[] = [];
    for (const row of rows) out.push({ ...row, secret: await this.resolveSecret(row) });
    return out;
  }

  public async create(input: {
    id: string;
    repositoryId: string;
    url: string;
    urlPrefix: string;
    secret: string;
    secretSuffix: string;
    events: readonly string[];
    creatorEmail: string;
    now: number;
  }): Promise<void> {
    const envelope = await encryptData(input.secret, this.masterKey);
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO repo_webhooks (id, repository_id, url, url_prefix, secret_suffix, is_active, consecutive_failures, last_delivery_at, last_delivery_status, creator_email, created_at, updated_at, encrypted_secret, secret_iv) VALUES (?, ?, ?, ?, ?, 1, 0, NULL, NULL, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.id,
            input.repositoryId,
            input.url,
            input.urlPrefix,
            input.secretSuffix,
            input.creatorEmail,
            input.now,
            input.now,
            envelope.encrypted,
            envelope.iv,
          )
          .run(),
      'create repo webhook',
    );
    // Events live only in the junction table (0024 dropped the JSON column).
    await this.replaceEvents(input.id, input.events, input.now);
  }

  public async listEvents(hookId: string): Promise<string[]> {
    const result = await this.database.prepare('SELECT event FROM webhook_events WHERE hook_id = ?').bind(hookId).all<{ event: string }>();
    return (result.results ?? []).map((row) => row.event);
  }

  public async replaceEvents(hookId: string, events: readonly string[], now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM webhook_events WHERE hook_id = ?').bind(hookId).run(),
      'replace webhook events',
    );
    for (const event of events) {
      await this.withRetry(
        () =>
          this.database
            .prepare('INSERT OR IGNORE INTO webhook_events (hook_id, event, created_at) VALUES (?, ?, ?)')
            .bind(hookId, event, now)
            .run(),
        'insert webhook event',
      );
    }
  }

  public async deleteEvents(hookId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM webhook_events WHERE hook_id = ?').bind(hookId).run(),
      'delete webhook events',
    );
  }

  // `full_name` is computed from `repositories` (0024 dropped the stored
  // copy): renames need no cascade here.
  private static readonly FULL_NAME_ALIAS =
    "(SELECT owner || '/' || name FROM repositories WHERE id = repo_webhooks.repository_id) AS full_name";

  public async listByRepo(repositoryId: string): Promise<RepoWebhookRow[]> {
    const result = await this.database
      .prepare(`SELECT repo_webhooks.*, ${WebhookDAO.FULL_NAME_ALIAS} FROM repo_webhooks WHERE repository_id = ? ORDER BY created_at ASC, id ASC`)
      .bind(repositoryId)
      .all<RepoWebhookRow>();
    return this.withDecryptedSecret(result.results ?? []);
  }

  public async getById(id: string): Promise<RepoWebhookRow | null> {
    const row = await this.database
      .prepare(`SELECT repo_webhooks.*, ${WebhookDAO.FULL_NAME_ALIAS} FROM repo_webhooks WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<RepoWebhookRow>();
    if (!row) return null;
    return { ...row, secret: await this.resolveSecret(row) };
  }

  public async getByIdAndRepo(id: string, repositoryId: string): Promise<RepoWebhookRow | null> {
    const row = await this.database
      .prepare(`SELECT repo_webhooks.*, ${WebhookDAO.FULL_NAME_ALIAS} FROM repo_webhooks WHERE id = ? AND repository_id = ? LIMIT 1`)
      .bind(id, repositoryId)
      .first<RepoWebhookRow>();
    if (!row) return null;
    return { ...row, secret: await this.resolveSecret(row) };
  }

  public async countByRepo(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS n FROM repo_webhooks WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  public async update(
    id: string,
    repositoryId: string,
    patch: { url?: string; urlPrefix?: string; events?: readonly string[]; isActive?: boolean; now: number },
  ): Promise<void> {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [patch.now];
    if (patch.url !== undefined && patch.urlPrefix !== undefined) {
      sets.push('url = ?', 'url_prefix = ?');
      params.push(patch.url, patch.urlPrefix);
    }
    if (patch.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(patch.isActive ? 1 : 0);
    }
    params.push(id, repositoryId);
    await this.withRetry(
      () =>
        this.database
          .prepare(`UPDATE repo_webhooks SET ${sets.join(', ')} WHERE id = ? AND repository_id = ?`)
          .bind(...params)
          .run(),
      'update repo webhook',
    );
    if (patch.events !== undefined) {
      await this.replaceEvents(id, patch.events, patch.now);
    }
  }

  public async rotateSecret(id: string, repositoryId: string, secret: string, secretSuffix: string, now: number): Promise<void> {
    const envelope = await encryptData(secret, this.masterKey);
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'UPDATE repo_webhooks SET secret_suffix = ?, consecutive_failures = 0, updated_at = ?, encrypted_secret = ?, secret_iv = ? WHERE id = ? AND repository_id = ?',
          )
          .bind(secretSuffix, now, envelope.encrypted, envelope.iv, id, repositoryId)
          .run(),
      'rotate repo webhook secret',
    );
  }

  public async recordDeliveryOutcome(hookId: string, success: boolean, now: number, disableAfterFailures: number): Promise<void> {
    if (success) {
      await this.withRetry(
        () =>
          this.database
            .prepare(
              'UPDATE repo_webhooks SET last_delivery_at = ?, last_delivery_status = ?, consecutive_failures = 0, updated_at = ? WHERE id = ?',
            )
            .bind(now, 'success', now, hookId)
            .run(),
        'record webhook delivery success',
      );
      return;
    }
    await this.withRetry(
      () =>
        this.database
          .prepare(
            `UPDATE repo_webhooks SET last_delivery_at = ?, last_delivery_status = ?, consecutive_failures = consecutive_failures + 1,
             is_active = CASE WHEN consecutive_failures + 1 >= ? THEN 0 ELSE is_active END, updated_at = ? WHERE id = ?`,
          )
          .bind(now, 'failure', disableAfterFailures, now, hookId)
          .run(),
      'record webhook delivery failure',
    );
  }

  public async deleteById(id: string, repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM repo_webhooks WHERE id = ? AND repository_id = ?').bind(id, repositoryId).run(),
      'delete repo webhook',
    );
    await this.deleteEvents(id).catch(() => undefined);
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM webhook_events WHERE hook_id IN (SELECT id FROM repo_webhooks WHERE repository_id = ?)')
          .bind(repositoryId)
          .run(),
      'delete webhook events by repo',
    ).catch(() => undefined);
    await this.withRetry(
      () => this.database.prepare('DELETE FROM repo_webhooks WHERE repository_id = ?').bind(repositoryId).run(),
      'delete webhooks by repo',
    );
  }
}

export { WebhookDAO };
export type { RepoWebhookRow };
