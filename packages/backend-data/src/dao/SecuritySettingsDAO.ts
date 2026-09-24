import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

type SecretScanMode = 'off' | 'warn' | 'block';

interface SecuritySettingsRow {
  repository_id: string;
  secret_scan_mode: SecretScanMode;
  updated_by: string | null;
  updated_at: number;
}

class SecuritySettingsDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async getByRepo(repositoryId: string): Promise<SecuritySettingsRow | null> {
    return this.findRowById<SecuritySettingsRow>('repo_security_settings', 'repository_id', repositoryId);
  }

  public async setScanMode(repositoryId: string, mode: SecretScanMode, updatedBy: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            `INSERT INTO repo_security_settings (repository_id, secret_scan_mode, updated_by, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (repository_id) DO UPDATE SET secret_scan_mode = excluded.secret_scan_mode, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          )
          .bind(repositoryId, mode, updatedBy, now)
          .run(),
      'set secret scan mode',
    );
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM repo_security_settings WHERE repository_id = ?').bind(repositoryId).run(),
      'delete security settings',
    );
  }
}

export { SecuritySettingsDAO };
export type { SecretScanMode, SecuritySettingsRow };
