/* eslint-disable @typescript-eslint/no-base-to-string -- DO SQLite rows are primitives (TEXT/INTEGER); Record<string, unknown> trips the object-stringification guard. */
import { deleteNodeCascade, getDeadProperties, renameNodeCascade, upsertNode } from '@durable-dav/dav-store';
import type { DofsFs, DurableSqlStorage } from '@durable-dav/dav-store';
import { normalizeLockDetails, type DavNodeInfo, type LockDetails } from '@durable-dav/webdav';
import { fsPathOf, hrefOf } from './DavContext';

// Repository over dofs + DO SQLite (why: the DO previously inlined every
// `dav_nodes/props/locks` statement, duplicating `dav-store/meta.ts` and
// swallowing failures per call site; centralizing here keeps SQL in one
// audited place and lets method handlers stay I/O-orchestration only).

interface StatResult {
  exists: boolean;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

interface NodeMeta {
  contentType?: string;
  etag?: string;
  mtime?: number;
  crtime?: number;
}

class DavRepository {
  constructor(
    private readonly dofs: DofsFs,
    private readonly sql: DurableSqlStorage,
  ) {}

  public statInner(innerPath: string): StatResult {
    try {
      const st = this.dofs.stat(fsPathOf(innerPath));
      return { exists: true, isDirectory: st.isDirectory, size: st.size ?? 0, mtime: st.mtime ?? Date.now() };
    } catch {
      return { exists: false, isDirectory: false, size: 0, mtime: 0 };
    }
  }

  public readMeta(innerPath: string): NodeMeta {
    try {
      const rows = this.sql.exec(`SELECT content_type, etag, mtime, crtime FROM dav_nodes WHERE path = ?`, innerPath).toArray();
      const row = rows[0];
      if (!row) return {};
      return {
        contentType: row['content_type'] == null ? undefined : String(row['content_type']),
        etag: row['etag'] == null ? undefined : String(row['etag']),
        mtime: row['mtime'] == null ? undefined : Number(row['mtime']),
        crtime: row['crtime'] == null ? undefined : Number(row['crtime']),
      };
    } catch {
      return {};
    }
  }

  public nodeInfo(innerPath: string, base: string): DavNodeInfo | null {
    const st = this.statInner(innerPath);
    if (!st.exists) return null;
    const meta = this.readMeta(innerPath);
    const mtime = new Date(meta.mtime ?? st.mtime ?? Date.now());
    const crtime = new Date(meta.crtime ?? mtime.getTime());
    let locks: LockDetails[] = [];
    try {
      const now = Date.now();
      this.sql.exec(`DELETE FROM dav_locks WHERE expires_at <= ?`, now);
      const rows = this.sql
        .exec(`SELECT token, scope, depth, owner, timeout, expires_at as expiresAt, root FROM dav_locks WHERE path = ?`, innerPath)
        .toArray();
      locks = rows.flatMap((row) => {
        const token = String(row['token'] ?? '');
        if (!token) return [];
        const normalized = normalizeLockDetails({
          token,
          owner: row['owner'] == null ? undefined : String(row['owner']),
          scope: row['scope'] === 'shared' ? 'shared' : 'exclusive',
          depth: row['depth'] === 'infinity' ? 'infinity' : '0',
          timeout: String(row['timeout'] ?? ''),
          expiresAt: Number(row['expiresAt'] ?? 0),
          root: hrefOf(base, innerPath, st.isDirectory),
        });
        return normalized ? [normalized] : [];
      });
    } catch {
      locks = [];
    }
    return {
      key: innerPath,
      isCollection: st.isDirectory,
      size: st.size,
      etag: meta.etag ?? `"${st.size.toString(16)}-${(meta.mtime ?? st.mtime).toString(16)}"`,
      mtime,
      crtime,
      contentType: meta.contentType,
      contentLanguage: undefined,
      displayname: innerPath === '' ? undefined : (innerPath.split('/').pop() ?? undefined),
      locks,
      deadProperties: getDeadProperties(this.sql, innerPath),
    };
  }

  public rootNode(): DavNodeInfo {
    const now = new Date();
    return {
      key: '',
      isCollection: true,
      size: 0,
      etag: undefined,
      mtime: now,
      crtime: now,
      contentType: undefined,
      contentLanguage: undefined,
      displayname: undefined,
      locks: [],
      deadProperties: [],
    };
  }

  public listChildren(innerPath: string): string[] {
    try {
      return this.dofs.listDir(fsPathOf(innerPath), {}).filter((n) => n !== '.' && n !== '..');
    } catch {
      return [];
    }
  }

  public listRecursive(innerPath: string): string[] {
    try {
      return this.dofs.listDir(fsPathOf(innerPath), { recursive: true }).filter((n) => n !== '.' && n !== '..');
    } catch {
      return [];
    }
  }

  /**
  Child path for a `listDir` entry (handles both relative and absolute returns).
  */
  public childInner(parent: string, name: string): string {
    if (name.startsWith('/')) return name.slice(1);
    return parent === '' ? name : `${parent}/${name}`;
  }

  public upsertFileNode(innerPath: string, contentType: string, etag: string, now: number, crtime?: number): void {
    try {
      upsertNode(this.sql, innerPath, { isCollection: false, contentType, etag, mtime: now, crtime });
    } catch {
      // Metadata is best-effort; file bytes already persisted.
    }
  }

  public upsertCollectionNode(innerPath: string, now: number): void {
    try {
      upsertNode(this.sql, innerPath, { isCollection: true, mtime: now, crtime: now });
    } catch {
      // Metadata is best-effort; directory already created.
    }
  }

  public copyMeta(from: string, to: string, isCollection: boolean): void {
    try {
      const rows = this.sql.exec(`SELECT content_type, etag FROM dav_nodes WHERE path = ?`, from).toArray();
      const row = rows[0];
      const now = Date.now();
      this.sql.exec(
        `INSERT INTO dav_nodes (path, is_collection, content_type, etag, mtime, crtime) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET is_collection=excluded.is_collection, content_type=excluded.content_type, etag=excluded.etag, mtime=excluded.mtime`,
        to,
        isCollection ? 1 : 0,
        row?.['content_type'] ?? null,
        row?.['etag'] ?? null,
        now,
        now,
      );
      const props = this.sql.exec(`SELECT namespace_uri, local_name, prefix, value_xml FROM dav_props WHERE path = ?`, from).toArray();
      for (const p of props) {
        this.sql.exec(
          `INSERT INTO dav_props (path, namespace_uri, local_name, prefix, value_xml) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path, namespace_uri, local_name) DO UPDATE SET prefix=excluded.prefix, value_xml=excluded.value_xml`,
          to,
          String(p['namespace_uri'] ?? ''),
          String(p['local_name'] ?? ''),
          p['prefix'] == null ? null : String(p['prefix']),
          String(p['value_xml'] ?? ''),
        );
      }
      // Locks are NOT copied (per RFC 4918 §9.8).
    } catch {
      // Metadata copy is best-effort; file bytes already copied.
    }
  }

  public deleteCascade(innerPath: string): void {
    try {
      deleteNodeCascade(this.sql, innerPath);
    } catch {
      // Filesystem delete already succeeded; metadata GC retries on next write.
    }
  }

  public renameCascade(from: string, to: string): void {
    try {
      renameNodeCascade(this.sql, from, to);
    } catch {
      // Filesystem rename already succeeded; metadata repair is best-effort.
    }
  }
}

export { DavRepository };
export type { StatResult, NodeMeta };
