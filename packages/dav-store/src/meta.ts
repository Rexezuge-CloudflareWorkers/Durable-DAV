import type { DeadProperty } from '@durable-dav/webdav';

type SqlRow = Record<string, unknown>;

type DurableSqlStorage = {
  exec: (query: string, ...bindings: unknown[]) => { toArray: () => SqlRow[]; one?: () => SqlRow | undefined };
};

function ensureDavSchema(sql: DurableSqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS dav_nodes (
      path TEXT PRIMARY KEY,
      is_collection INTEGER NOT NULL DEFAULT 0,
      content_type TEXT,
      content_language TEXT,
      displayname TEXT,
      etag TEXT,
      mtime INTEGER NOT NULL,
      crtime INTEGER NOT NULL
    );
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS dav_props (
      path TEXT NOT NULL,
      namespace_uri TEXT NOT NULL,
      local_name TEXT NOT NULL,
      prefix TEXT,
      value_xml TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (path, namespace_uri, local_name)
    );
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_dav_props_path ON dav_props(path);`);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS dav_locks (
      token TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'exclusive',
      depth TEXT NOT NULL DEFAULT '0',
      owner TEXT,
      timeout TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL,
      root TEXT NOT NULL DEFAULT '/'
    );
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_dav_locks_path ON dav_locks(path);`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_dav_locks_expires ON dav_locks(expires_at);`);
}

function nowMs(): number {
  return Date.now();
}

function stringField(row: SqlRow, key: string, fallback = ''): string {
  const value = row[key];
  if (typeof value === 'string') return value;
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : fallback;
}

function nullableStringField(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value) : undefined;
}

function upsertNode(
  sql: DurableSqlStorage,
  path: string,
  fields: { isCollection: boolean; contentType?: string; etag?: string; mtime?: number; crtime?: number },
): void {
  const mtime = fields.mtime ?? nowMs();
  const crtime = fields.crtime ?? mtime;
  sql.exec(
    `INSERT INTO dav_nodes (path, is_collection, content_type, etag, mtime, crtime)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET is_collection=excluded.is_collection, content_type=excluded.content_type, etag=excluded.etag, mtime=excluded.mtime`,
    path,
    fields.isCollection ? 1 : 0,
    fields.contentType ?? null,
    fields.etag ?? null,
    mtime,
    crtime,
  );
}

/**
 * SQL fragment + bindings selecting `path` itself plus every descendant.
 *
 * Why `SUBSTR` and not `LIKE '${path}/%'`: SQL `LIKE` treats `_` as "any one
 * character" unless an `ESCAPE` clause is supplied, and `_` is legal in bucket
 * and file names. Deleting `report_2024` therefore also matched
 * `reportX2024/...` — the filesystem subtree was removed but rows for *live*
 * files were deleted too, while rows for already-deleted files survived. A
 * prefix-length comparison has no metacharacters and stays index-friendly
 * (the existing `path` indexes still cover it).
 */
function subtreePredicate(path: string): { clause: string; bindings: unknown[] } {
  return { clause: '(path = ? OR SUBSTR(path, 1, ?) = ?)', bindings: [path, path.length + 1, `${path}/`] };
}

const CASCADE_TABLES = ['dav_nodes', 'dav_props', 'dav_locks'] as const;

function deleteNodeCascade(sql: DurableSqlStorage, path: string): void {
  if (path === '') {
    for (const table of CASCADE_TABLES) sql.exec(`DELETE FROM ${table}`);
    return;
  }
  const { clause, bindings } = subtreePredicate(path);
  for (const table of CASCADE_TABLES) sql.exec(`DELETE FROM ${table} WHERE ${clause}`, ...bindings);
}

function renameNodeCascade(sql: DurableSqlStorage, from: string, to: string): void {
  const { clause, bindings } = subtreePredicate(from);
  for (const table of CASCADE_TABLES) {
    // The leading `from` segment is replaced by the `to` binding; `SUBSTR`
    // re-anchors the untouched suffix. Only the table name is interpolated and
    // it comes from the closed `CASCADE_TABLES` set, never from input.
    sql.exec(`UPDATE ${table} SET path = ? || SUBSTR(path, ?) WHERE ${clause}`, to, from.length + 1, ...bindings);
  }
}

function getDeadProperties(sql: DurableSqlStorage, path: string): DeadProperty[] {
  try {
    const rows = sql.exec(`SELECT namespace_uri, local_name, prefix, value_xml FROM dav_props WHERE path = ?`, path).toArray();
    return rows.map((row) => ({
      namespaceURI: stringField(row, 'namespace_uri', ''),
      localName: stringField(row, 'local_name', ''),
      prefix: nullableStringField(row, 'prefix') ?? null,
      valueXml: stringField(row, 'value_xml', ''),
    }));
  } catch {
    return [];
  }
}

export { ensureDavSchema, upsertNode, deleteNodeCascade, renameNodeCascade, getDeadProperties };
export type { DurableSqlStorage };
