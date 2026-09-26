import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import type { DavCredentialInternal, DavCredentialMetadata } from '@durable-dav/shared/model';
import { TimestampUtil, UUIDUtil } from '@durable-dav/shared/utils';

class DavCredentialDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(
    volumeId: string,
    username: string,
    passwordHash: string,
    name: string,
    passwordPrefix: string,
    passwordLastFour: string,
    expiresAt: number,
  ): Promise<DavCredentialMetadata> {
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const credentialId = UUIDUtil.getRandomUUID();
    await this.withRetry(
      () =>
        this.database
          .prepare(
            `INSERT INTO dav_credentials
              (credential_id, volume_id, username, password_hash, name, password_prefix, password_last_four, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(credentialId, volumeId, username, passwordHash, name, passwordPrefix, passwordLastFour, now, expiresAt)
          .run(),
      'create dav credential',
    );
    const credential = await this.getById(credentialId);
    if (!credential) throw new Error('Failed to load DAV credential after create.');
    return credential;
  }

  /**
   * Load the active credential for a username, including its stored hash.
   *
   * The password is *not* part of the lookup. Passwords are salted (PBKDF2), so
   * two users with the same password have different hashes and no hash can be
   * searched on. The caller verifies the password against the returned
   * `passwordHash` with a constant-time compare. `username` is globally unique,
   * so at most one row can match.
   *
   * The hash is intentionally part of the return value — it is the input to
   * verification, and returning a metadata projection without it would force a
   * second query on the auth hot path.
   */
  public async getActiveByUsername(
    username: string,
  ): Promise<(DavCredentialMetadata & { volumeId: string; passwordHash: string }) | undefined> {
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const row = await this.database
      .prepare(
        `SELECT credential_id, volume_id, username, password_hash, name, password_prefix, password_last_four, created_at, expires_at, last_used_at
         FROM dav_credentials
         WHERE username = ? AND expires_at > ?
         LIMIT 1`,
      )
      .bind(username, now)
      .first<DavCredentialInternal>();
    if (!row) return undefined;
    const metadata = this.toMetadata(row);
    return metadata ? { ...metadata, passwordHash: row.password_hash } : undefined;
  }

  public async getById(credentialId: string): Promise<DavCredentialMetadata | undefined> {
    const row = await this.database
      .prepare(
        `SELECT credential_id, volume_id, username, password_hash, name, password_prefix, password_last_four, created_at, expires_at, last_used_at
         FROM dav_credentials WHERE credential_id = ? LIMIT 1`,
      )
      .bind(credentialId)
      .first<DavCredentialInternal>();
    return row ? this.toMetadata(row) : undefined;
  }

  public async listByVolume(volumeId: string): Promise<DavCredentialMetadata[]> {
    const result = await this.database
      .prepare(
        `SELECT credential_id, volume_id, username, password_hash, name, password_prefix, password_last_four, created_at, expires_at, last_used_at
         FROM dav_credentials WHERE volume_id = ? ORDER BY created_at DESC`,
      )
      .bind(volumeId)
      .all<DavCredentialInternal>();
    return (result.results ?? []).map((row) => this.toMetadata(row));
  }

  public async countByVolume(volumeId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM dav_credentials WHERE volume_id = ?')
      .bind(volumeId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  public async usernameExists(username: string): Promise<boolean> {
    const row = await this.database
      .prepare('SELECT 1 AS found FROM dav_credentials WHERE username = ? LIMIT 1')
      .bind(username)
      .first<{ found: number }>();
    return Boolean(row?.found);
  }

  /**
   * Replace a credential's password hash.
   *
   * Used by the opportunistic legacy-digest upgrade on the auth path. `prefix`
   * and `last_four` are stored alongside the hash for display only and do not
   * change, so they are intentionally not rewritten here.
   */
  public async updatePasswordHash(credentialId: string, passwordHash: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE dav_credentials SET password_hash = ? WHERE credential_id = ?')
          .bind(passwordHash, credentialId)
          .run(),
      'update dav credential password hash',
    );
  }

  public async updateLastUsed(credentialId: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE dav_credentials SET last_used_at = ? WHERE credential_id = ?')
          .bind(TimestampUtil.getCurrentUnixTimestampInSeconds(), credentialId)
          .run(),
      'update dav credential last used',
    );
  }

  public async deleteForVolume(credentialId: string, volumeId: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database.prepare('DELETE FROM dav_credentials WHERE credential_id = ? AND volume_id = ?').bind(credentialId, volumeId).run(),
      'delete dav credential',
    );
  }

  public async deleteByVolume(volumeId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM dav_credentials WHERE volume_id = ?').bind(volumeId).run(),
      'delete dav credentials by volume',
    );
  }

  public async pruneExpired(now: number, limit: number): Promise<number> {
    return this.deleteRowsOlderThan('dav_credentials', 'expires_at', now, limit, 'credential_id');
  }

  private toMetadata(row: DavCredentialInternal): DavCredentialMetadata {
    return {
      credentialId: row.credential_id,
      volumeId: row.volume_id,
      name: row.name,
      username: row.username,
      passwordPrefix: row.password_prefix,
      passwordLastFour: row.password_last_four,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    };
  }
}

export { DavCredentialDAO };
