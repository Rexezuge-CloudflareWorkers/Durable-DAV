import { DatabaseError } from '@duradav/backend-errors';
import { decryptData, encryptData } from '../crypto/aes-gcm';
import type { D1Queryable } from '../utils/D1Types';
import { EncryptedDAO } from './BaseDAO';

type ImportStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

function parseRefsJson(raw: string): Array<{ ref: string; oid: string | null }> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Array<{ ref: string; oid: string | null }> = [];
    for (const entry of parsed) {
      const ref = (entry as { ref?: unknown }).ref;
      if (typeof ref !== 'string' || ref.length === 0) continue;
      const oid = (entry as { oid?: unknown }).oid;
      out.push({ ref, oid: typeof oid === 'string' ? oid : null });
    }
    return out;
  } catch {
    return [];
  }
}

interface RepoImportRow {
  id: string;
  repository_id: string;
  // Decrypted source URL (output only, never a stored column since 0027
  // dropped the plaintext `source_url` column). Envelope lives in
  // `encrypted_source_url`/`source_url_iv` under `IMPORT_ENCRYPTION_KEY_SECRET`.
  source_url: string;
  encrypted_source_url: string;
  source_url_iv: string;
  status: ImportStatus;
  error: string | null;
  imported_refs: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

class ImportDAO extends EncryptedDAO {
  constructor(database: D1Queryable, masterKey: string) {
    super(database, masterKey);
  }

  private async resolveSourceUrl(row: RepoImportRow): Promise<string> {
    if (!this.masterKey) throw new DatabaseError('Import encryption key is not configured for this scope.');
    if (!row.encrypted_source_url || !row.source_url_iv) throw new DatabaseError('Import source URL envelope is missing.');
    try {
      return await decryptData(row.encrypted_source_url, row.source_url_iv, this.masterKey);
    } catch (error) {
      throw new DatabaseError(`Failed to decrypt import source URL: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private async withDecryptedSourceUrl(rows: RepoImportRow[]): Promise<RepoImportRow[]> {
    const out: RepoImportRow[] = [];
    for (const row of rows) out.push({ ...row, source_url: await this.resolveSourceUrl(row) });
    return out;
  }

  public async create(input: { id: string; repositoryId: string; sourceUrl: string; createdBy: string; now: number }): Promise<void> {
    const envelope = await encryptData(input.sourceUrl, this.masterKey);
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO repo_imports (id, repository_id, status, error, imported_refs, created_by, created_at, updated_at, encrypted_source_url, source_url_iv) VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)',
          )
          .bind(input.id, input.repositoryId, 'pending', input.createdBy, input.now, input.now, envelope.encrypted, envelope.iv)
          .run(),
      'create repo import',
    );
  }

  public async getById(id: string): Promise<RepoImportRow | null> {
    const row = await this.findRowById<RepoImportRow>('repo_imports', 'id', id);
    if (!row) return null;
    return { ...row, source_url: await this.resolveSourceUrl(row) };
  }

  public async latestByRepo(repositoryId: string): Promise<RepoImportRow | null> {
    const row = await this.database
      .prepare('SELECT * FROM repo_imports WHERE repository_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .bind(repositoryId)
      .first<RepoImportRow>();
    if (!row) return null;
    return { ...row, source_url: await this.resolveSourceUrl(row) };
  }

  public async hasActiveForRepo(repositoryId: string): Promise<boolean> {
    const row = await this.database
      .prepare("SELECT id FROM repo_imports WHERE repository_id = ? AND status IN ('pending', 'running') LIMIT 1")
      .bind(repositoryId)
      .first<{ id: string }>();
    return row !== null;
  }

  public async countActiveForRepo(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare("SELECT COUNT(*) AS n FROM repo_imports WHERE repository_id = ? AND status IN ('pending', 'running')")
      .bind(repositoryId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  public async claimDue(limit: number, staleAfterSeconds: number, now: number): Promise<RepoImportRow[]> {
    const cutoff = now - staleAfterSeconds;
    const result = await this.database
      .prepare(
        "SELECT * FROM repo_imports WHERE status = 'pending' OR (status = 'running' AND updated_at < ?) ORDER BY created_at ASC, id ASC LIMIT ?",
      )
      .bind(cutoff, limit)
      .all<RepoImportRow>();
    const rows = await this.withDecryptedSourceUrl(result.results ?? []);
    for (const row of rows) {
      await this.withRetry(
        () =>
          this.database
            .prepare("UPDATE repo_imports SET status = 'running', updated_at = ? WHERE id = ? AND status IN ('pending', 'running')")
            .bind(now, row.id)
            .run(),
        'claim repo import',
      );
    }
    return rows;
  }

  public async markDone(id: string, refsJson: string, importedRefs: number, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            "UPDATE repo_imports SET status = 'done', error = NULL, imported_refs = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'running')",
          )
          .bind(importedRefs, now, id)
          .run(),
      'mark repo import done',
    );
    // Refs live only in the junction table (0024 dropped the JSON column);
    // the JSON argument is parsed transiently, never stored.
    await this.replaceRefs(id, parseRefsJson(refsJson), now);
  }

  public async listRefs(importId: string): Promise<Array<{ ref: string; oid: string | null }>> {
    const result = await this.database
      .prepare('SELECT ref_name, oid FROM repo_import_refs WHERE import_id = ?')
      .bind(importId)
      .all<{ ref_name: string; oid: string | null }>();
    return (result.results ?? []).map((row) => ({ ref: row.ref_name, oid: row.oid }));
  }

  public async replaceRefs(importId: string, refs: ReadonlyArray<{ ref: string; oid: string | null }>, now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM repo_import_refs WHERE import_id = ?').bind(importId).run(),
      'replace repo import refs',
    );
    for (const ref of refs) {
      await this.withRetry(
        () =>
          this.database
            .prepare('INSERT OR IGNORE INTO repo_import_refs (import_id, ref_name, oid, created_at) VALUES (?, ?, ?, ?)')
            .bind(importId, ref.ref, ref.oid, now)
            .run(),
        'insert repo import ref',
      );
    }
  }

  public async markFailed(id: string, error: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare("UPDATE repo_imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'running')")
          .bind(error.slice(0, 500), now, id)
          .run(),
      'mark repo import failed',
    );
  }

  public async markCancelled(id: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare("UPDATE repo_imports SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending', 'running')")
          .bind(now, id)
          .run(),
      'cancel repo import',
    );
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM repo_import_refs WHERE import_id IN (SELECT id FROM repo_imports WHERE repository_id = ?)')
          .bind(repositoryId)
          .run(),
      'delete repo import refs',
    ).catch(() => undefined);
    await this.withRetry(
      () => this.database.prepare('DELETE FROM repo_imports WHERE repository_id = ?').bind(repositoryId).run(),
      'delete repo imports',
    );
  }
}

export { ImportDAO };
export type { ImportStatus, RepoImportRow };
