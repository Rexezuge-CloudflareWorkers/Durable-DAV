import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import type { TokenScope } from '@duradav/shared';

interface TokenVolumeGrantRow {
  token_id: string;
  volume_id: string;
  scope: TokenScope;
  created_at: number;
}

class TokenVolumeGrantDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async listByToken(tokenId: string): Promise<TokenVolumeGrantRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM token_volume_grants WHERE token_id = ? ORDER BY volume_id ASC')
      .bind(tokenId)
      .all<TokenVolumeGrantRow>();
    return result.results ?? [];
  }

  public async setGrants(tokenId: string, grants: Array<{ volumeId: string; scope: TokenScope }>, now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM token_volume_grants WHERE token_id = ?').bind(tokenId).run(),
      'clear token volume grants',
    );
    for (const grant of grants) {
      await this.withRetry(
        () =>
          this.database
            .prepare('INSERT INTO token_volume_grants (token_id, volume_id, scope, created_at) VALUES (?, ?, ?, ?)')
            .bind(tokenId, grant.volumeId, grant.scope, now)
            .run(),
        'insert token volume grant',
      );
    }
  }

  public async deleteByToken(tokenId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM token_volume_grants WHERE token_id = ?').bind(tokenId).run(),
      'delete token volume grants',
    );
  }

  public async deleteByVolume(volumeId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM token_volume_grants WHERE volume_id = ?').bind(volumeId).run(),
      'delete token grants for volume',
    );
  }
}

export { TokenVolumeGrantDAO };
export type { TokenVolumeGrantRow };
