/* eslint-disable @typescript-eslint/require-await -- Facade keeps async for DO RPC uniformity. */
import { DurableObject } from 'cloudflare:workers';
import { createDofsFs, setDofsDeviceSize, ensureDavSchema, upsertNode } from '@durable-dav/dav-store';
import type { DofsFs, DurableSqlStorage } from '@durable-dav/dav-store';
import { DAV_CLASS, SUPPORT_METHODS } from '@durable-dav/webdav';
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
    this.ensureSize();
    const url = new URL(request.url);
    const base = this.baseOf(request);
    const innerPath = resolveInnerPath(request, url, base);
    if (!isValidInnerPath(innerPath)) return new Response('Bad Request', { status: 400 });

    const sql = this.sql();
    const repo = new DavRepository(this.dofs, sql);
    const locks = new DavLockGuard(sql);

    switch (request.method) {
      case 'OPTIONS': {
        return new Response(null, { status: 200, headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS } });
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
        return handleCopy(request, innerPath, base, repo, locks, this.dofs, async (destInner) =>
          this.removeDestination(destInner, repo),
        );
      }
      case 'MOVE': {
        return handleMove(request, innerPath, base, repo, locks, this.dofs, async (destInner, req) => {
          const del = await handleDelete(req, destInner, repo, locks, this.dofs);
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
        return handleUnlock(request, innerPath, { repo, locks, sql, writeEmptyFile: async () => false, statIsDirectory: () => false });
      }
      default: {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS },
        });
      }
    }
  }

  private async removeDestination(destInner: string, repo: DavRepository): Promise<Response | null> {
    const destStat = repo.statInner(destInner);
    if (destStat.isDirectory) {
      try {
        this.dofs.rmdir(fsPathOf(destInner), { recursive: true });
      } catch {
        return new Response('Internal Server Error', { status: 500 });
      }
    } else {
      try {
        this.dofs.unlink(fsPathOf(destInner));
      } catch {
        // Missing destination is fine; overwrite proceeds.
      }
    }
    repo.deleteCascade(destInner);
    return null;
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

export { DavVolumeWorker };
