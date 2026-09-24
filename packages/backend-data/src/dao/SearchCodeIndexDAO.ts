import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import { isMissingSchemaError } from '../utils/D1ErrorClassifier';
import { rowsOrEmpty, throwUnlessMissingSchema } from './SearchFallback';
import { UPSERT_CODE_FILE_SQL } from './SearchQueries';

interface CodeHit {
  repo_id: string;
  path: string;
  oid: string | null;
  content: string;
  updated_at: number;
}

interface CodeOidEntry {
  path: string;
  oid: string | null;
}

interface CodeFileInput {
  repoId: string;
  path: string;
  oid: string | null;
  content: string;
  now: number;
}

type CodeIndexRow = CodeHit;
type CodeOidPair = CodeOidEntry;
type CodeIndexUpsert = CodeFileInput;

/**
 * Code-index maintenance DAO (Facade split from `SearchDAO`).
 *
 * Why: `SearchDAO` mixed FTS reads (repos/issues/pulls/code/discussions/
 * snippets) with code-index writes (upsert/batch/dirty-check/prune) and hit
 * the god-file guard. Reads stay in `SearchDAO`; all `code_index` writes
 * live here. `SearchDAO` composes this class and delegates so existing
 * callers (`SearchService`, backfill cron, tests) keep working unchanged.
 */
class SearchCodeIndexDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async upsertCodeFile(input: CodeFileInput): Promise<number> {
    try {
      const result = await this.withRetry(
        () => this.database.prepare(UPSERT_CODE_FILE_SQL).bind(input.repoId, input.path, input.oid, input.content, input.now).run(),
        'upsert code index',
      );
      return result.meta?.changes ?? 0;
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      return 0;
    }
  }

  public async upsertCodeFiles(inputs: CodeFileInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    try {
      const database = this.database;
      if (typeof database.batch === 'function') {
        try {
          const statements = inputs.map((input) =>
            database.prepare(UPSERT_CODE_FILE_SQL).bind(input.repoId, input.path, input.oid, input.content, input.now),
          );
          const results = await database.batch(statements);
          return results.reduce((total, result) => total + ((result.meta?.changes ?? 0) || 0), 0);
        } catch (error) {
          if (!isMissingSchemaError(error)) throw error;
        }
      }
      let changed = 0;
      for (const input of inputs) {
        changed += await this.upsertCodeFile(input);
      }
      return changed;
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      return 0;
    }
  }

  public async getOidsByRepo(repoId: string): Promise<CodeOidEntry[]> {
    try {
      const result = await this.database.prepare('SELECT path, oid FROM code_index WHERE repo_id = ?').bind(repoId).all<CodeOidEntry>();
      return rowsOrEmpty(result);
    } catch (error) {
      throwUnlessMissingSchema(error, 'indexed oids');
      return [];
    }
  }

  public async pruneStaleCodePaths(repoId: string, keepPaths: string[]): Promise<number> {
    try {
      if (keepPaths.length === 0) {
        const result = await this.withRetry(
          () => this.database.prepare('DELETE FROM code_index WHERE repo_id = ?').bind(repoId).run(),
          'delete stale code index',
        );
        return result.meta?.changes ?? 0;
      }
      const placeholders = keepPaths.map(() => '?').join(', ');
      const result = await this.withRetry(
        () =>
          this.database
            .prepare(`DELETE FROM code_index WHERE repo_id = ? AND path NOT IN (${placeholders})`)
            .bind(repoId, ...keepPaths)
            .run(),
        'delete stale code index',
      );
      return result.meta?.changes ?? 0;
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      return 0;
    }
  }

  /**
   * @deprecated Use `pruneStaleCodePaths`.
   */
  public async deleteCodePathsNotIn(repoId: string, keepPaths: string[]): Promise<number> {
    return this.pruneStaleCodePaths(repoId, keepPaths);
  }

  public async deleteCodeFile(repoId: string, path: string): Promise<void> {
    try {
      await this.withRetry(
        () => this.database.prepare('DELETE FROM code_index WHERE repo_id = ? AND path = ?').bind(repoId, path).run(),
        'delete code index file',
      );
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
    }
  }

  public async deleteCodeByRepo(repoId: string): Promise<void> {
    try {
      await this.withRetry(
        () => this.database.prepare('DELETE FROM code_index WHERE repo_id = ?').bind(repoId).run(),
        'delete code index by repo',
      );
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
    }
  }

  public async deleteByRepo(repoId: string): Promise<void> {
    await this.deleteCodeByRepo(repoId);
  }
}

export { SearchCodeIndexDAO };
export type { CodeFileInput, CodeHit, CodeOidEntry, CodeIndexRow, CodeOidPair, CodeIndexUpsert };
