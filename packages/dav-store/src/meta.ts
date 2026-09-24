import type { DeadProperty, LockDetails } from '@duradav/webdav';

type SqlExecutor = {
  exec: (sql: string, ...params: unknown[]) => unknown;
};

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

function pruneExpiredLocks(sql: DurableSqlStorage, now = nowMs()): void {
  try {
    sql.exec(`DELETE FROM dav_locks WHERE expires_at <= ?`, now);
  } catch {
    // best-effort; read path still filters expired rows
  }
}

function listLocksForPath(sql: DurableSqlStorage, path: string, now = nowMs()): LockDetails[] {
  pruneExpiredLocks(sql, now);
  const rows = sql.exec(`SELECT token, scope, depth, owner, timeout, expires_at as expiresAt, root FROM dav_locks WHERE path = ?`, path).toArray();
  return rows.flatMap((row) => {
    const token = String(row['token'] ?? '');
    if (!token) return [];
    const expiresAt = Number(row['expiresAt'] ?? 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return [];
    return [
      {
        token,
        owner: row['owner'] == null ? undefined : String(row['owner']),
        scope: row['scope'] === 'shared' ? 'shared' : 'exclusive',
        depth: row['depth'] === 'infinity' ? 'infinity' : '0',
        timeout: String(row['timeout'] ?? ''),
        expiresAt,
        root: String(row['root'] ?? '/'),
      },
    ];
  });
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

function deleteNodeCascade(sql: DurableSqlStorage, path: string): void {
  if (path === '') {
    sql.exec(`DELETE FROM dav_nodes`);
    sql.exec(`DELETE FROM dav_props`);
    sql.exec(`DELETE FROM dav_locks`);
    return;
  }
  const prefix = `${path}/`;
  sql.exec(`DELETE FROM dav_nodes WHERE path = ? OR path LIKE ?`, path, `${prefix}%`);
  sql.exec(`DELETE FROM dav_props WHERE path = ? OR path LIKE ?`, path, `${prefix}%`);
  sql.exec(`DELETE FROM dav_locks WHERE path = ? OR path LIKE ?`, path, `${prefix}%`);
}

function renameNodeCascade(sql: DurableSqlStorage, from: string, to: string): void {
  const fromPrefix = `${from}/`;
  const toPrefix = `${to}/`;
  sql.exec(`UPDATE dav_nodes SET path = ? || SUBSTR(path, ?) WHERE path = ? OR path LIKE ?`, to, from.length + 1, from, `${fromPrefix}%`);
  sql.exec(`UPDATE dav_props SET path = ? || SUBSTR(path, ?) WHERE path = ? OR path LIKE ?`, to, from.length + 1, from, `${fromPrefix}%`);
  sql.exec(`UPDATE dav_locks SET path = ? || SUBSTR(path, ?) WHERE path = ? OR path LIKE ?`, to, from.length + 1, from, `${fromPrefix}%`);
}

function getDeadProperties(sql: DurableSqlStorage, path: string): DeadProperty[] {
  try {
    const rows = sql.exec(`SELECT namespace_uri, local_name, prefix, value_xml FROM dav_props WHERE path = ?`, path).toArray();
    return rows.map((row) => ({
      namespaceURI: String(row['namespace_uri'] ?? ''),
      localName: String(row['local_name'] ?? ''),
      prefix: row['prefix'] == null ? null : String(row['prefix']),
      valueXml: String(row['value_xml'] ?? ''),
    }));
  } catch {
    return [];
  }
}

export { ensureDavSchema, pruneExpiredLocks, listLocksForPath, upsertNode, deleteNodeCascade, renameNodeCascade, getDeadProperties };
export type { SqlExecutor, SqlRow, DurableSqlStorage };
