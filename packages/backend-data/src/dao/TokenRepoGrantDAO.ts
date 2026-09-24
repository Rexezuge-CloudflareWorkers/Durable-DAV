import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import type { TokenScope } from '@duradav/shared';

interface TokenRepoGrantRow {
  token_id: string;
  repository_id: string;
  scope: TokenScope;
  created_at: number;
}

class TokenRepoGrantDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async listByToken(tokenId: string): Promise<TokenRepoGrantRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM token_repo_grants WHERE token_id = ? ORDER BY repository_id ASC')
      .bind(tokenId)
      .all<TokenRepoGrantRow>();
    return result.results ?? [];
  }

  public async setGrants(tokenId: string, grants: Array<{ repositoryId: string; scope: TokenScope }>, now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM token_repo_grants WHERE token_id = ?').bind(tokenId).run(),
      'clear token repo grants',
    );
    for (const grant of grants) {
      await this.withRetry(
        () =>
          this.database
            .prepare('INSERT INTO token_repo_grants (token_id, repository_id, scope, created_at) VALUES (?, ?, ?, ?)')
            .bind(tokenId, grant.repositoryId, grant.scope, now)
            .run(),
        'insert token repo grant',
      );
    }
  }

  public async deleteByToken(tokenId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM token_repo_grants WHERE token_id = ?').bind(tokenId).run(),
      'delete token repo grants',
    );
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM token_repo_grants WHERE repository_id = ?').bind(repositoryId).run(),
      'delete token grants for repo',
    );
  }
}

export { TokenRepoGrantDAO };
export type { TokenRepoGrantRow };
