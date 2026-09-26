/* eslint-disable @typescript-eslint/require-await -- Facade keeps async for DO RPC uniformity. */
import { DurableObject } from 'cloudflare:workers';
import { createDofsFs, setDofsDeviceSize, ensureDavSchema, getDeadProperties, upsertNode } from '@durable-dav/dav-store';
import type { DofsFs, DurableSqlStorage } from '@durable-dav/dav-store';
import { DAV_CLASS, SUPPORT_METHODS } from '@durable-dav/webdav';
import type { DeadProperty } from '@durable-dav/webdav';
import { AppConfiguration } from '@durable-dav/backend-runtime/config';
import { DavRepository } from './dav/DavRepository';
import { DavLockGuard } from './dav/DavLockGuard';
import { fsPathOf, isValidInnerPath, resolveInnerPath } from './dav/DavContext';
import { handleGet } from './dav/methods/ReadMethods';
import { handleDelete, handleMkcol, handlePut } from './dav/methods/WriteMethods';
import { handlePropfind, handleProppatch } from './dav/methods/PropMethods';
import { handleCopy, handleMove } from './dav/methods/CopyMoveMethods';
import { handleLock, handleUnlock } from './dav/methods/LockMethods';

// Facade over the WebDAV volume (why: the previous 1000-line god-file mixed
// routing, SQL, and every RFC 4918 method; method logic now lives in
// `dav/methods/*` Commands + `DavRepository`/`DavLockGuard`, so this class
// only owns lifecycle, dispatch, and per-request wiring — mirroring the Git
// `RepoWorker` facade pattern).
class DavVolumeWorker extends DurableObject<Env> {
  private readonly dofs: DofsFs;
  private readonly config: AppConfiguration;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.dofs = createDofsFs(ctx, env);
    this.config = AppConfiguration.fromEnv(env);
    try {
      ensureDavSchema(ctx.storage.sql);
    } catch {
      // Schema bootstrap races on warm isolates; per-operation ensure below.
    }
  }

  private ensureSize(): void {
    try {
      setDofsDeviceSize(this.dofs, this.config.getDoDeviceBytes());
    } catch {
      // Device size is best-effort; writes surface real quota errors.
    }
  }

  private sql(): DurableSqlStorage {
    const sql = this.ctx.storage.sql as unknown as DurableSqlStorage;
    try {
      ensureDavSchema(sql);
    } catch {
      // Per-op ensure is best-effort; statements surface real errors.
    }
    return sql;
  }

  private baseOf(request: Request): string {
    return request.headers.get('X-Dav-Base') ?? '';
  }

  public override async fetch(request: Request): Promise<Response> {
    // Error boundary. Individual handlers have ad-hoc catch blocks with
    // inconsistent policies, and several body reads (`arrayBuffer`, `text`,
    // `clone`) reject on a truncated or aborted client stream — the front
    // forwards raw bodies with `duplex: 'half'`. Without this, one such
    // rejection escaped as a bare runtime 500 carrying no `DAV`/`Allow`
    // headers. Lock-lookup failures also surface here now that
    // `DavLockGuard` propagates instead of reporting "unlocked".
    try {
      this.ensureSize();
      return await this.dispatch(request);
    } catch (error) {
      console.error('DavVolumeWorker request failed', {
        method: request.method,
        url: request.url,
        error: error instanceof Error ? (error.stack ?? error.message) : error,
      });
      return new Response('Internal Server Error', {
        status: 500,
        headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }

  private async dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const base = this.baseOf(request);
    const innerPath = resolveInnerPath(request, url, base);
    if (innerPath === null) return new Response('Bad Request', { status: 400 });
    if (!isValidInnerPath(innerPath)) return new Response('Bad Request', { status: 400 });

    const sql = this.sql();
    const repo = new DavRepository(this.dofs, sql);
    const locks = new DavLockGuard(sql);

    switch (request.method) {
      case 'OPTIONS': {
        // RFC 4918 §9.1 + RFC 7231 §4.3.7: `OPTIONS *` is a server-wide
        // capability probe. `Content-Length: 0` and `MS-Author-Via` are
        // expected by Windows/Office Explorer's DAV discovery.
        return new Response(null, {
          status: 200,
          headers: {
            Allow: SUPPORT_METHODS.join(', '),
            DAV: DAV_CLASS,
            'MS-Author-Via': 'DAV',
            'Content-Length': '0',
          },
        });
      }
      case 'HEAD': {
        return handleGet(request, innerPath, base, true, repo, this.dofs);
      }
      case 'GET': {
        return handleGet(request, innerPath, base, false, repo, this.dofs);
      }
      case 'PUT': {
        return handlePut(request, innerPath, repo, locks, this.dofs, this.config.getMaxFileBytes());
      }
      case 'DELETE': {
        return handleDelete(request, innerPath, repo, locks, this.dofs);
      }
      case 'MKCOL': {
        return handleMkcol(request, innerPath, repo, locks, this.dofs);
      }
      case 'PROPFIND': {
        return handlePropfind(request, innerPath, base, repo);
      }
      case 'PROPPATCH': {
        return handleProppatch(request, innerPath, base, repo, locks, sql);
      }
      case 'COPY': {
        // COPY reuses `handleDelete` for the overwrite step, exactly as MOVE
        // does. The previous dedicated `removeDestination` reimplemented DELETE
        // minus its descendant-lock scan, so `COPY` with `Overwrite: T` could
        // `rmdir --recursive` a collection whose children were individually
        // locked — a Class 2 violation that MOVE handled correctly. Sharing one
        // implementation makes the question unaskable.
        return handleCopy(request, innerPath, base, repo, locks, this.dofs, async (destInner, overwriteRequest) => {
          const del = await handleDelete(overwriteRequest, destInner, repo, locks, this.dofs);
          return del.ok || del.status === 204 ? null : del;
        });
      }
      case 'MOVE': {
        return handleMove(request, innerPath, base, repo, locks, this.dofs, async (destInner, overwriteRequest) => {
          const del = await handleDelete(overwriteRequest, destInner, repo, locks, this.dofs);
          return del.ok || del.status === 204 ? null : del;
        });
      }
      case 'LOCK': {
        return handleLock(request, innerPath, base, {
          repo,
          locks,
          sql,
          writeEmptyFile: async (p) => this.writeEmptyFile(p),
          statIsDirectory: (p) => repo.statInner(p).isDirectory,
        });
      }
      case 'UNLOCK': {
        return handleUnlock(request, innerPath, {
          repo,
          sql,
          unlink: (p) => this.dofs.unlink(fsPathOf(p)),
        });
      }
      default: {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS },
        });
      }
    }
  }

  private async writeEmptyFile(innerPath: string): Promise<boolean> {
    try {
      await this.dofs.writeFile(fsPathOf(innerPath), new Uint8Array().buffer, {});
    } catch {
      return false;
    }
    try {
      const now = Date.now();
      upsertNode(this.sql(), innerPath, { isCollection: false, mtime: now, crtime: now });
    } catch {
      // Metadata is best-effort; zero-byte file already exists.
    }
    return true;
  }

  public async setVolumeKey(volumeKey: string): Promise<void> {
    try {
      await this.ctx.storage.put('volumeKey', volumeKey);
    } catch {
      // Lifecycle bookkeeping is best-effort; routing uses the DO id.
    }
  }

  // Username-rename transfer primitives (Git `RepoWorker` copy pattern).
  // Locks are never copied (RFC 4918 §9.8); dead props follow file bytes.
  public async listVolumeEntries(): Promise<
    Array<{
      path: string;
      isCollection: boolean;
      contentType: string | null;
      etag: string | null;
      props: DeadProperty[];
    }>
  > {
    this.ensureSize();
    const sql = this.sql();
    const repo = new DavRepository(this.dofs, sql);
    let names: string[] = [];
    try {
      names = repo.listRecursive('');
    } catch {
      return [];
    }
    const entries: Array<{
      path: string;
      isCollection: boolean;
      contentType: string | null;
      etag: string | null;
      props: DeadProperty[];
    }> = [];
    for (const name of names) {
      const innerPath = repo.childInner('', name);
      if (!isValidInnerPath(innerPath)) continue;
      const st = repo.statInner(innerPath);
      if (!st.exists) continue;
      const meta = repo.readMeta(innerPath);
      let props: DeadProperty[] = [];
      try {
        props = getDeadProperties(sql, innerPath);
      } catch {
        props = [];
      }
      entries.push({
        path: innerPath,
        isCollection: st.isDirectory,
        contentType: meta.contentType ?? null,
        etag: meta.etag ?? null,
        props,
      });
    }
    return entries;
  }

  public async readVolumeFile(path: string): Promise<{ dataBase64: string; contentType: string | null } | null> {
    this.ensureSize();
    if (path === '' || !isValidInnerPath(path)) return null;
    const sql = this.sql();
    const repo = new DavRepository(this.dofs, sql);
    const st = repo.statInner(path);
    if (!st.exists || st.isDirectory) return null;
    try {
      const buf = this.dofs.read(fsPathOf(path), {});
      const bytes = new Uint8Array(buf.slice(0));
      return { dataBase64: bytesToBase64(bytes), contentType: repo.readMeta(path).contentType ?? null };
    } catch {
      return null;
    }
  }

  public async writeVolumeEntry(entry: {
    path: string;
    isCollection: boolean;
    contentType?: string | null;
    etag?: string | null;
    dataBase64?: string | null;
    props?: DeadProperty[];
  }): Promise<void> {
    this.ensureSize();
    // Must throw, not return: `VolumeMove.moveOneVolume` purges the source DO
    // once every entry is written, so a silently skipped entry turned a
    // username rename into unrecoverable data loss. Throwing here engages the
    // caller's existing rollback + rethrow.
    if (!isValidInnerPath(entry.path) || entry.path === '') {
      throw new Error(`writeVolumeEntry: invalid volume entry path ${JSON.stringify(entry.path)}`);
    }
    const sql = this.sql();
    const repo = new DavRepository(this.dofs, sql);
    const parent = entry.path.split('/').slice(0, -1).join('/');
    if (parent !== '') {
      try {
        this.dofs.mkdir(fsPathOf(parent), { recursive: true });
      } catch {
        // Parent may already exist; file/collection op surfaces real errors.
      }
      const segments = parent.split('/');
      for (let i = 1; i <= segments.length; i += 1) {
        repo.upsertCollectionNode(segments.slice(0, i).join('/'), Date.now());
      }
    }
    if (entry.isCollection) {
      try {
        this.dofs.mkdir(fsPathOf(entry.path), { recursive: false });
      } catch {
        // Existing collection is fine; metadata upsert below still applies.
      }
      repo.upsertCollectionNode(entry.path, Date.now());
    } else {
      const bytes = entry.dataBase64 ? base64ToBytes(entry.dataBase64) : new Uint8Array();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      await this.dofs.writeFile(fsPathOf(entry.path), copy.buffer, {});
      const now = Date.now();
      repo.upsertFileNode(entry.path, entry.contentType ?? 'application/octet-stream', entry.etag ?? `"${bytes.byteLength.toString(16)}-${now.toString(16)}"`, now);
    }
    const props = entry.props ?? [];
    for (const prop of props) {
      try {
        sql.exec(
          `INSERT INTO dav_props (path, namespace_uri, local_name, prefix, value_xml) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path, namespace_uri, local_name) DO UPDATE SET prefix=excluded.prefix, value_xml=excluded.value_xml`,
          entry.path,
          prop.namespaceURI ?? '',
          prop.localName ?? '',
          prop.prefix ?? null,
          prop.valueXml ?? '',
        );
      } catch {
        // Dead-prop copy is best-effort; file bytes already persisted.
      }
    }
  }

  public async deleteVolume(): Promise<void> {
    try {
      this.dofs.rmdir('/', { recursive: true });
    } catch {
      // Missing root is fine on repeated deletes.
    }
    try {
      const sql = this.sql();
      sql.exec(`DELETE FROM dav_nodes`);
      sql.exec(`DELETE FROM dav_props`);
      sql.exec(`DELETE FROM dav_locks`);
    } catch {
      // Filesystem delete already succeeded; metadata GC retries on next op.
    }
    try {
      await this.ctx.storage.delete('volumeKey');
    } catch {
      // Lifecycle bookkeeping is best-effort.
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = (binary.codePointAt(i) ?? 0) & 0xff;
  return out;
}

export { DavVolumeWorker };
