import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import type { TokenScope, UserAccessTokenMetadata } from '@duradav/shared';

export interface TokenRow {
  token_id: string;
  user_email: string;
  token_hash: string;
  name: string;
  expires_at: number;
  last_used_at: number | null;
  created_at: number;
  token_prefix?: string | null;
}

function toMetadata(row: TokenRow, scopes: TokenScope[]): UserAccessTokenMetadata {
  return {
    tokenId: row.token_id,
    userEmail: row.user_email,
    tokenHash: row.token_hash,
    name: row.name,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    // Scopes live only in `token_scopes` (0024 dropped the JSON column):
    // fail closed to `[]` when the junction has no rows.
    scopes,
    tokenPrefix: row.token_prefix ?? null,
  };
}

class UserAccessTokenDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(
    tokenId: string,
    userEmail: string,
    tokenHash: string,
    name: string,
    expiresAt: number,
    now: number,
    scopes?: readonly TokenScope[] | null,
    tokenPrefix?: string | null,
  ): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO user_access_tokens (token_id, user_email, token_hash, name, expires_at, last_used_at, created_at, token_prefix) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
          )
          .bind(tokenId, userEmail.toLowerCase(), tokenHash, name, expiresAt, now, tokenPrefix ?? null)
          .run(),
      'create access token',
    );
    // Scopes live only in the junction table: fail closed by rolling back
    // the row when the junction write fails (a token without scopes must
    // never silently exist as unrestricted).
    try {
      await this.replaceScopes(tokenId, scopes ?? [], now);
    } catch (error) {
      await this.database.prepare('DELETE FROM user_access_tokens WHERE token_id = ?').bind(tokenId).run().catch(() => undefined);
      throw error;
    }
  }

  public async listScopes(tokenId: string): Promise<TokenScope[]> {
    const result = await this.database
      .prepare("SELECT scope FROM token_scopes WHERE token_id = ? AND scope IN ('dav:read', 'dav:write', 'admin', 'repo:read', 'repo:write')")
      .bind(tokenId)
      .all<{ scope: TokenScope }>();
    return (result.results ?? []).map((row) => row.scope);
  }

  public async replaceScopes(tokenId: string, scopes: readonly TokenScope[], now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM token_scopes WHERE token_id = ?').bind(tokenId).run(),
      'replace token scopes',
    );
    for (const scope of scopes) {
      await this.withRetry(
        () =>
          this.database
            .prepare('INSERT OR IGNORE INTO token_scopes (token_id, scope, created_at) VALUES (?, ?, ?)')
            .bind(tokenId, scope, now)
            .run(),
        'insert token scope',
      );
    }
  }

  public async deleteScopes(tokenId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM token_scopes WHERE token_id = ?').bind(tokenId).run(),
      'delete token scopes',
    );
  }

  private async withJunctionScopes(row: TokenRow): Promise<UserAccessTokenMetadata> {
    // Fail closed: an empty junction means deny (never full access).
    const scopes = await this.listScopes(row.token_id).catch(() => [] as TokenScope[]);
    return toMetadata(row, scopes);
  }

  public async getByTokenHash(tokenHash: string, nowSeconds: number): Promise<UserAccessTokenMetadata | undefined> {
    const row = await this.database
      .prepare('SELECT * FROM user_access_tokens WHERE token_hash = ? AND expires_at > ? LIMIT 1')
      .bind(tokenHash, nowSeconds)
      .first<TokenRow>();
    if (!row) return undefined;
    return this.withJunctionScopes(row);
  }

  public async getByUserEmail(userEmail: string): Promise<UserAccessTokenMetadata[]> {
    const result = await this.database
      .prepare('SELECT * FROM user_access_tokens WHERE lower(user_email) = lower(?) ORDER BY created_at DESC')
      .bind(userEmail)
      .all<TokenRow>();
    const rows = result.results ?? [];
    const out: UserAccessTokenMetadata[] = [];
    for (const row of rows) out.push(await this.withJunctionScopes(row));
    return out;
  }

  public async updateLastUsedByHash(tokenHash: string, now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE user_access_tokens SET last_used_at = ? WHERE token_hash = ?').bind(now, tokenHash).run(),
      'update token last used',
    );
  }

  public async delete(tokenId: string, userEmail: string): Promise<boolean> {
    const result = await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM user_access_tokens WHERE token_id = ? AND lower(user_email) = lower(?)')
          .bind(tokenId, userEmail)
          .run(),
      'delete access token',
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
  }

  public async rotate(tokenId: string, userEmail: string, newHash: string, newPrefix: string, newExpiresAt: number): Promise<boolean> {
    const result = await this.withRetry(
      () =>
        this.database
          .prepare(
            'UPDATE user_access_tokens SET token_hash = ?, token_prefix = ?, expires_at = ?, last_used_at = NULL WHERE token_id = ? AND lower(user_email) = lower(?)',
          )
          .bind(newHash, newPrefix, newExpiresAt, tokenId, userEmail)
          .run(),
      'rotate access token',
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
  }

  public async pruneExpired(now: number, limit: number): Promise<number> {
    return this.deleteRowsOlderThan('user_access_tokens', 'expires_at', now, limit, 'token_id');
  }
}

export { UserAccessTokenDAO };
