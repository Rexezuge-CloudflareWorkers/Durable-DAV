/* eslint-disable @typescript-eslint/no-base-to-string -- DO SQLite rows are primitives (TEXT/INTEGER); Record<string, unknown> trips the object-stringification guard. */
/* eslint-disable sonarjs/void-use, @typescript-eslint/require-await -- ported WebDAV handlers keep r2-webdav shape (void for unused base, async for uniform dispatch). */
/* eslint-disable unicorn/prefer-simple-condition-first, sonarjs/no-redundant-boolean, sonarjs/prefer-regexp-exec, unicorn/no-await-expression-member, sonarjs/no-all-duplicated-branches, unicorn/no-useless-template-literals -- ported r2-webdav logic, behavior parity over style. */
import { DurableObject } from 'cloudflare:workers';
import { createDofsFs, setDofsDeviceSize, ensureDavSchema, getDeadProperties } from '@durable-dav/dav-store';
import type { DofsFs, DurableSqlStorage } from '@durable-dav/dav-store';
import {
  escapeXml,
  getParentPath,
  parseDestinationPath,
  isSameOrDescendantPath,
  stripSlashes,
  parsePropfindRequest,
  parseProppatchRequest,
  generatePropfindResponse,
  isProtectedProperty,
  determineLockDepth,
  normalizeLockToken,
  normalizeLockDetails,
  getLockDiscovery,
  parseTimeout,
  getRequestLockTokens,
  hasAlwaysFalseIfCondition,
  extractLockOwner,
  renderEmptyPropertyElement,
  DAV_CLASS,
  SUPPORT_METHODS,
  createdResponse,
  type DeadProperty,
  type LockDetails,
  type DavNodeInfo,
} from '@durable-dav/webdav';
import { AppConfiguration } from '@durable-dav/backend-runtime/config';

type DavSql = DurableSqlStorage;

function sqlOf(ctx: DurableObjectState): DavSql {
  return ctx.storage.sql;
}

function fsPathOf(innerPath: string): string {
  if (innerPath === '') return '/';
  return `/${innerPath}`;
}

function hrefOf(base: string, innerPath: string, isCollection: boolean): string {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  if (innerPath === '') return `${prefix}/`;
  return `${prefix}/${innerPath.split('/').map(encodeURIComponent).join('/')}${isCollection ? '/' : ''}`;
}

class DavVolumeWorker extends DurableObject<Env> {
  private readonly dofs: DofsFs;
  private readonly config: AppConfiguration;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.dofs = createDofsFs(ctx, env);
    this.config = AppConfiguration.fromEnv(env);
    try {
      ensureDavSchema(sqlOf(ctx));
    } catch {
      // schema bootstrap races on warm isolate; per-op ensure below
    }
  }

  private ensureSize(): void {
    try {
      setDofsDeviceSize(this.dofs, this.config.getDoDeviceBytes());
    } catch {
      // ignore
    }
  }

  private sql(): DavSql {
    const sql = sqlOf(this.ctx);
    try {
      ensureDavSchema(sql);
    } catch {
      // ignore
    }
    return sql;
  }

  private baseOf(request: Request): string {
    return request.headers.get('X-Dav-Base') ?? '';
  }

  private statInner(innerPath: string): { exists: boolean; isDirectory: boolean; size: number; mtime: number } {
    try {
      const st = this.dofs.stat(fsPathOf(innerPath));
      return { exists: true, isDirectory: st.isDirectory, size: st.size ?? 0, mtime: st.mtime ?? Date.now() };
    } catch {
      return { exists: false, isDirectory: false, size: 0, mtime: 0 };
    }
  }

  private readMeta(innerPath: string): { contentType?: string; etag?: string; mtime?: number; crtime?: number } {
    try {
      const rows = this.sql()
        .exec(`SELECT content_type, etag, mtime, crtime FROM dav_nodes WHERE path = ?`, innerPath)
        .toArray();
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

  private nodeInfo(innerPath: string, base: string): DavNodeInfo | null {
    const st = this.statInner(innerPath);
    if (!st.exists) return null;
    const meta = this.readMeta(innerPath);
    const mtime = new Date(meta.mtime ?? st.mtime ?? Date.now());
    const crtime = new Date(meta.crtime ?? mtime.getTime());
    const sql = this.sql();
    let locks: LockDetails[] = [];
    try {
      const now = Date.now();
      sql.exec(`DELETE FROM dav_locks WHERE expires_at <= ?`, now);
      const rows = sql
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
      key: innerPath === '' ? '' : innerPath,
      isCollection: st.isDirectory,
      size: st.size,
      etag: meta.etag ?? `"${st.size.toString(16)}-${(meta.mtime ?? st.mtime).toString(16)}"`,
      mtime,
      crtime,
      contentType: meta.contentType,
      contentLanguage: undefined,
      displayname: innerPath === '' ? undefined : (innerPath.split('/').pop() ?? undefined),
      locks,
      deadProperties: getDeadProperties(sql, innerPath),
    };
  }

  private assertLock(request: Request, innerPath: string, opts: { ignoreSharedOnTarget?: boolean } = {}): Response | null {
    if (hasAlwaysFalseIfCondition(request)) return new Response('Precondition Failed', { status: 412 });
    const tokens = getRequestLockTokens(request);
    const sql = this.sql();
    const candidates: string[] = [];
    for (let cur = innerPath; ; cur = getParentPath(cur)) {
      candidates.push(cur);
      if (cur === '') break;
    }
    for (const candidate of candidates) {
      let rows: Array<Record<string, unknown>> = [];
      try {
        const now = Date.now();
        rows = sql
          .exec(`SELECT token, scope, depth, expires_at as expiresAt FROM dav_locks WHERE path = ? AND expires_at > ?`, candidate, now)
          .toArray();
      } catch {
        continue;
      }
      const active = rows.filter((r) => {
        const depth = String(r['depth'] ?? '0');
        if (candidate !== innerPath && depth !== 'infinity') return false;
        if (opts.ignoreSharedOnTarget && candidate === innerPath && String(r['scope']) === 'shared') return false;
        return true;
      });
      if (active.length === 0) continue;
      if (active.every((r) => !tokens.includes(String(r['token'] ?? '')))) {
        return new Response('Locked', { status: 423 });
      }
    }
    return null;
  }

  private listChildren(innerPath: string): string[] {
    try {
      const names = this.dofs.listDir(fsPathOf(innerPath), {});
      return names.filter((n) => n !== '.' && n !== '..');
    } catch {
      return [];
    }
  }

  private listRecursive(innerPath: string): string[] {
    try {
      const names = this.dofs.listDir(fsPathOf(innerPath), { recursive: true });
      return names.filter((n) => n !== '.' && n !== '..');
    } catch {
      return [];
    }
  }

  public override async fetch(request: Request): Promise<Response> {
    this.ensureSize();
    const url = new URL(request.url);
    const base = this.baseOf(request);
    // inner path: strip base prefix (/owner/volume) from pathname, fallback to header
    let innerPath = stripSlashes(request.headers.get('X-Dav-Path') ?? '');
    if (!request.headers.get('X-Dav-Path')) {
      const pathname = url.pathname;
      if (base && pathname.startsWith(base)) {
        innerPath = stripSlashes(pathname.slice(base.length));
      } else {
        const parts = stripSlashes(pathname).split('/');
        innerPath = parts.length >= 3 ? parts.slice(2).join('/') : '';
      }
      try {
        innerPath = innerPath
          .split('/')
          .map((s) => decodeURIComponent(s))
          .join('/');
      } catch {
        // keep raw
      }
    }

    switch (request.method) {
      case 'OPTIONS': {
        return new Response(null, { status: 200, headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS } });
      }
      case 'HEAD': {
        return this.handleGet(request, innerPath, base, true);
      }
      case 'GET': {
        return this.handleGet(request, innerPath, base, false);
      }
      case 'PUT': {
        return this.handlePut(request, innerPath, base);
      }
      case 'DELETE': {
        return this.handleDelete(request, innerPath, base);
      }
      case 'MKCOL': {
        return this.handleMkcol(request, innerPath, base);
      }
      case 'PROPFIND': {
        return this.handlePropfind(request, innerPath, base);
      }
      case 'PROPPATCH': {
        return this.handleProppatch(request, innerPath, base);
      }
      case 'COPY': {
        return this.handleCopy(request, innerPath, base);
      }
      case 'MOVE': {
        return this.handleMove(request, innerPath, base);
      }
      case 'LOCK': {
        return this.handleLock(request, innerPath, base);
      }
      case 'UNLOCK': {
        return this.handleUnlock(request, innerPath, base);
      }
      default: {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS },
        });
      }
    }
  }

  private async handleGet(request: Request, innerPath: string, base: string, headOnly: boolean): Promise<Response> {
    const st = this.statInner(innerPath);
    if (request.url.endsWith('/') || innerPath === '' || st.isDirectory) {
      if (innerPath !== '' && (!st.exists || !st.isDirectory)) return new Response('Not Found', { status: 404 });
      if (headOnly) return new Response(null, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      const children = innerPath === '' && false ? [] : this.listChildren(innerPath);
      let items = '';
      if (innerPath !== '') items += `<a href="../">..</a><br>`;
      for (const name of children) {
        const childInner = innerPath === '' ? name : `${innerPath}/${name}`;
        const childStat = this.statInner(childInner);
        const href = hrefOf(base, childInner, childStat.isDirectory);
        items += `<a href="${escapeXml(href)}">${escapeXml(name)}${childStat.isDirectory ? '/' : ''}</a><br>`;
      }
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Durable-DAV</title><style>*{box-sizing:border-box}body{padding:10px;font-family:system-ui,sans-serif}a{display:inline-block;width:100%;color:#000;text-decoration:none;padding:5px 10px;border-radius:5px}a:hover{background:#0ea5e9;color:#fff}</style></head><body><h1>Durable-DAV ${escapeXml(base)}/${escapeXml(innerPath)}</h1><div>${items}</div></body></html>`;
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (!st.exists) return new Response('Not Found', { status: 404 });
    const meta = this.readMeta(innerPath);
    const rangeHeader = request.headers.get('Range');
    let offset = 0;
    let length: number | undefined;
    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (m) {
        if (m[1] === '' && m[2] !== '') {
          const suffix = Number(m[2]);
          if (Number.isFinite(suffix) && suffix > 0) {
            offset = Math.max(0, st.size - suffix);
            length = st.size - offset;
          }
        } else {
          offset = Number(m[1] || 0);
          length = m[2] === '' ? st.size - offset : Number(m[2]) - offset + 1;
        }
      }
    }
    let body: ReadableStream | ArrayBuffer;
    let contentLength = st.size;
    let contentRange: string | undefined;
    try {
      if (length === undefined) {
        body = this.dofs.readFile(fsPathOf(innerPath), {});
        contentLength = st.size;
      } else {
        const buf = this.dofs.read(fsPathOf(innerPath), { offset, length });
        body = buf;
        contentLength = buf.byteLength;
        contentRange = `bytes ${offset}-${offset + contentLength - 1}/${st.size}`;
      }
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    if (headOnly) return new Response(null, { status: 200, headers: { 'Content-Type': meta.contentType ?? 'application/octet-stream', 'Content-Length': String(contentLength), ETag: meta.etag ?? '', 'Accept-Ranges': 'bytes' } });
    const status = contentRange ? 206 : 200;
    const headers: Record<string, string> = {
      'Content-Type': meta.contentType ?? 'application/octet-stream',
      'Content-Length': String(contentLength),
      'Accept-Ranges': 'bytes',
    };
    if (meta.etag) headers['ETag'] = meta.etag;
    if (contentRange) headers['Content-Range'] = contentRange;
    return new Response(body as BodyInit, { status, headers });
  }

  private async handlePut(request: Request, innerPath: string, _base: string): Promise<Response> {
    if (request.url.endsWith('/') || innerPath === '') return new Response('Method Not Allowed', { status: 405 });
    const locked = this.assertLock(request, innerPath);
    if (locked) return locked;
    const parent = getParentPath(innerPath);
    const parentStat = parent === '' ? { exists: true, isDirectory: true } : this.statInner(parent);
    if (!parentStat.exists || !('isDirectory' in parentStat && (parentStat as { isDirectory: boolean }).isDirectory)) {
      // parent must be collection
      const ps = parent === '' ? true : this.statInner(parent).isDirectory;
      if (!ps) return new Response('Conflict', { status: 409 });
    }
    const existing = this.statInner(innerPath);
    if (existing.isDirectory) return new Response('Method Not Allowed', { status: 405 });
    const buf = await request.arrayBuffer();
    const maxBytes = Number((this.env as unknown as Record<string, string>)['MAX_FILE_BYTES'] ?? 52_428_800);
    if (buf.byteLength > maxBytes) return new Response('Payload Too Large', { status: 413 });
    try {
      await this.dofs.writeFile(fsPathOf(innerPath), buf.slice(0), {});
    } catch {
      return new Response('Insufficient Storage', { status: 507 });
    }
    const contentType = request.headers.get('Content-Type') ?? 'application/octet-stream';
    const now = Date.now();
    const etag = `"${buf.byteLength.toString(16)}-${now.toString(16)}"`;
    try {
      const sql = this.sql();
      const prev = this.readMeta(innerPath);
      sql.exec(
        `INSERT INTO dav_nodes (path, is_collection, content_type, etag, mtime, crtime) VALUES (?, 0, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET is_collection=0, content_type=excluded.content_type, etag=excluded.etag, mtime=excluded.mtime`,
        innerPath,
        contentType,
        etag,
        now,
        prev.crtime ?? now,
      );
    } catch {
      // ignore meta failure
    }
    return existing.exists ? new Response(null, { status: 204 }) : new Response('', { status: 201 });
  }

  private async handleDelete(request: Request, innerPath: string, _base: string): Promise<Response> {
    if (innerPath === '') return new Response('Forbidden', { status: 403 });
    const st = this.statInner(innerPath);
    if (!st.exists) return new Response('Not Found', { status: 404 });
    // check target + ancestors + descendants for locks
    const locked = this.assertLock(request, innerPath);
    if (locked) return locked;
    if (st.isDirectory) {
      const descendants = this.listRecursive(innerPath);
      const tokens = getRequestLockTokens(request);
      const sql = this.sql();
      for (const name of descendants) {
        // listDir recursive returns names relative? dofs returns full? handle both
        const childInner = name.startsWith('/') ? name.slice(1) : `${innerPath}/${name}`;
        try {
          const rows = sql.exec(`SELECT token FROM dav_locks WHERE path = ? AND expires_at > ?`, childInner, Date.now()).toArray();
          if (rows.length > 0 && rows.every((r) => !tokens.includes(String(r['token'] ?? '')))) {
            return new Response('Locked', { status: 423 });
          }
        } catch {
          continue;
        }
      }
      try {
        this.dofs.rmdir(fsPathOf(innerPath), { recursive: true });
      } catch {
        return new Response('Internal Server Error', { status: 500 });
      }
      try {
        const prefix = `${innerPath}/`;
        sql.exec(`DELETE FROM dav_nodes WHERE path = ? OR path LIKE ?`, innerPath, `${prefix}%`);
        sql.exec(`DELETE FROM dav_props WHERE path = ? OR path LIKE ?`, innerPath, `${prefix}%`);
        sql.exec(`DELETE FROM dav_locks WHERE path = ? OR path LIKE ?`, innerPath, `${prefix}%`);
      } catch {
        // ignore
      }
      return new Response(null, { status: 204 });
    }
    try {
      this.dofs.unlink(fsPathOf(innerPath));
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    try {
      const sql = this.sql();
      sql.exec(`DELETE FROM dav_nodes WHERE path = ?`, innerPath);
      sql.exec(`DELETE FROM dav_props WHERE path = ?`, innerPath);
      sql.exec(`DELETE FROM dav_locks WHERE path = ?`, innerPath);
    } catch {
      // ignore
    }
    return new Response(null, { status: 204 });
  }

  private async handleMkcol(request: Request, innerPath: string, _base: string): Promise<Response> {
    if ((await request.clone().arrayBuffer()).byteLength > 0) return new Response('Unsupported Media Type', { status: 415 });
    if (innerPath === '') return new Response('Method Not Allowed', { status: 405 });
    const locked = this.assertLock(request, innerPath);
    if (locked) return locked;
    const st = this.statInner(innerPath);
    if (st.exists) return new Response('Method Not Allowed', { status: 405 });
    const parent = getParentPath(innerPath);
    if (parent !== '' && !this.statInner(parent).isDirectory) return new Response('Conflict', { status: 409 });
    try {
      this.dofs.mkdir(fsPathOf(innerPath), { recursive: false });
    } catch {
      return new Response('Conflict', { status: 409 });
    }
    try {
      const now = Date.now();
      this.sql().exec(
        `INSERT INTO dav_nodes (path, is_collection, mtime, crtime) VALUES (?, 1, ?, ?) ON CONFLICT(path) DO UPDATE SET is_collection=1, mtime=excluded.mtime`,
        innerPath,
        now,
        now,
      );
    } catch {
      // ignore
    }
    return new Response('', { status: 201 });
  }

  private async handlePropfind(request: Request, innerPath: string, base: string): Promise<Response> {
    const body = await request.text();
    const parsed = parsePropfindRequest(body);
    if (!parsed) return new Response('Bad Request', { status: 400 });
    const node = innerPath === '' ? this.rootNode(base) : this.nodeInfo(innerPath, base);
    if (innerPath !== '' && !node) return new Response('Not Found', { status: 404 });
    let page = `<?xml version="1.0" encoding="utf-8"?>\n<multistatus xmlns="DAV:">`;
    const mode = parsed.mode;
    const props = parsed.mode === 'prop' ? parsed.properties : [];
    page += generatePropfindResponse(node, mode, props);
    const isCollection = node?.isCollection ?? true;
    if (isCollection) {
      const depth = request.headers.get('Depth') ?? 'infinity';
      if (depth !== '0' && depth !== '1' && depth !== 'infinity') return new Response('Bad Request', { status: 400 });
      if (depth !== '0') {
        const children = this.listChildren(innerPath);
        const recursive = depth === 'infinity' ? this.listRecursive(innerPath) : [];
        const seen = new Set<string>();
        for (const name of children) {
          const childInner = innerPath === '' ? name : `${innerPath}/${name}`;
          seen.add(childInner);
          const child = this.nodeInfo(childInner, base);
          if (child) page += generatePropfindResponse(child, mode, props);
        }
        if (depth === 'infinity') {
          for (const name of recursive) {
            const childInner = name.startsWith('/') ? name.slice(1) : innerPath === '' ? name : `${innerPath}/${name}`;
            if (seen.has(childInner)) continue;
            const child = this.nodeInfo(childInner, base);
            if (child) page += generatePropfindResponse(child, mode, props);
          }
        }
      }
    }
    page += '\n</multistatus>\n';
    return new Response(page, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  }

  private rootNode(_base: string): DavNodeInfo {
    let locks: LockDetails[] = [];
    try {
      locks =
        getDeadProperties.length === 0
          ? []
          : [];
      void locks;
    } catch {
      // ignore
    }
    return {
      key: '',
      isCollection: true,
      size: 0,
      etag: undefined,
      mtime: new Date(),
      crtime: new Date(),
      contentType: undefined,
      contentLanguage: undefined,
      displayname: undefined,
      locks: [],
      deadProperties: [],
    };
  }

  private async handleProppatch(request: Request, innerPath: string, base: string): Promise<Response> {
    const locked = this.assertLock(request, innerPath);
    if (locked) return locked;
    const node = innerPath === '' ? this.rootNode(base) : this.nodeInfo(innerPath, base);
    if (!node && innerPath !== '') return new Response('Not Found', { status: 404 });
    const body = await request.text();
    const parsed = parseProppatchRequest(body);
    if (!parsed) return new Response('Bad Request', { status: 400 });
    const sql = this.sql();
    const okSets: DeadProperty[] = [];
    const okRemoves: DeadProperty[] = [];
    const failedSets: DeadProperty[] = [];
    const failedRemoves: DeadProperty[] = [];
    const pendingSets: DeadProperty[] = [];
    const pendingRemoves: DeadProperty[] = [];
    for (const op of parsed.operations) {
      if (isProtectedProperty(op.property)) {
        if (op.action === 'set') failedSets.push(op.property);
        else failedRemoves.push(op.property);
        continue;
      }
      if (op.action === 'set') {
        pendingSets.push(op.property);
        okSets.push(op.property);
      } else {
        pendingRemoves.push(op.property);
        okRemoves.push(op.property);
      }
    }
    const hasFailures = failedSets.length > 0 || failedRemoves.length > 0;
    if (!hasFailures) {
      for (const p of pendingSets) {
        try {
          sql.exec(
            `INSERT INTO dav_props (path, namespace_uri, local_name, prefix, value_xml) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path, namespace_uri, local_name) DO UPDATE SET prefix=excluded.prefix, value_xml=excluded.value_xml`,
            innerPath,
            p.namespaceURI,
            p.localName,
            p.prefix,
            p.valueXml,
          );
        } catch {
          // ignore
        }
      }
      for (const p of pendingRemoves) {
        try {
          sql.exec(`DELETE FROM dav_props WHERE path = ? AND namespace_uri = ? AND local_name = ?`, innerPath, p.namespaceURI, p.localName);
        } catch {
          // ignore
        }
      }
    }
    const successStatus = hasFailures ? 'HTTP/1.1 424 Failed Dependency' : 'HTTP/1.1 200 OK';
    const propstats = new Map<string, string[]>();
    const append = (p: DeadProperty, status: string) => {
      const list = propstats.get(status) ?? [];
      list.push(renderEmptyPropertyElement({ ...p, valueXml: '' }));
      propstats.set(status, list);
    };
    for (const p of okSets) append(p, successStatus);
    for (const p of okRemoves) append(p, successStatus);
    for (const p of failedSets) append(p, 'HTTP/1.1 403 Forbidden');
    for (const p of failedRemoves) append(p, 'HTTP/1.1 403 Forbidden');
    let xml = `<?xml version="1.0" encoding="utf-8"?>\n<multistatus xmlns="DAV:">\n<response>\n<href>${escapeXml(hrefOf(base, innerPath, node?.isCollection ?? false))}</href>`;
    for (const [status, props] of propstats) {
      xml += `\n<propstat>\n<prop>\n${props.map((s) => `${s}`).join('\n')}\n</prop>\n<status>${status}</status>\n</propstat>`;
    }
    xml += '\n</response>\n</multistatus>';
    return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  }

  private async handleCopy(request: Request, innerPath: string, base: string): Promise<Response> {
    const destHeader = request.headers.get('Destination');
    if (!destHeader) return new Response('Bad Request', { status: 400 });
    const destFull = parseDestinationPath(destHeader, request.url);
    if (destFull === null) return new Response('Bad Request', { status: 400 });
    // destFull is full path incl base? front forwards original URL, so dest contains /owner/vol/inner
    const destInner = this.stripBase(destFull, base);
    if (destInner === null) return new Response('Bad Request', { status: 400 });
    if (isSameOrDescendantPath(innerPath, destInner)) return new Response('Bad Request', { status: 400 });
    const locked = this.assertLock(request, destInner);
    if (locked) return locked;
    const srcStat = this.statInner(innerPath);
    if (!srcStat.exists) return new Response('Not Found', { status: 404 });
    const destParent = getParentPath(destInner);
    if (destParent !== '' && !this.statInner(destParent).isDirectory) return new Response('Conflict', { status: 409 });
    const overwrite = request.headers.get('Overwrite') !== 'F';
    const destExists = this.statInner(destInner).exists;
    if (!overwrite && destExists) return new Response('Precondition Failed', { status: 412 });
    if (destExists) {
      // delete dest first (respect locks already checked)
      if (this.statInner(destInner).isDirectory) {
        try {
          this.dofs.rmdir(fsPathOf(destInner), { recursive: true });
        } catch {
          return new Response('Internal Server Error', { status: 500 });
        }
      } else {
        try {
          this.dofs.unlink(fsPathOf(destInner));
        } catch {
          // ignore
        }
      }
    }
    if (srcStat.isDirectory) {
      const depth = request.headers.get('Depth') ?? 'infinity';
      if (depth !== '0' && depth !== 'infinity') return new Response('Bad Request', { status: 400 });
      try {
        this.dofs.mkdir(fsPathOf(destInner), { recursive: false });
      } catch {
        if (!destExists) return new Response('Conflict', { status: 409 });
      }
      this.copyMeta(innerPath, destInner, true);
      if (depth === 'infinity') {
        const descendants = this.listRecursive(innerPath);
        for (const name of descendants) {
          const srcChild = name.startsWith('/') ? name.slice(1) : `${innerPath}/${name}`;
          const rel = srcChild.slice(innerPath.length + 1);
          const dstChild = `${destInner}/${rel}`;
          const cs = this.statInner(srcChild);
          if (cs.isDirectory) {
            try {
              this.dofs.mkdir(fsPathOf(dstChild), { recursive: false });
            } catch {
              // ignore
            }
          } else {
            try {
              const buf = this.dofs.read(fsPathOf(srcChild), {});
              await this.dofs.writeFile(fsPathOf(dstChild), buf.slice(0), {});
            } catch {
              continue;
            }
          }
          this.copyMeta(srcChild, dstChild, false);
        }
      }
      return destExists ? new Response(null, { status: 204 }) : createdResponse(hrefOf(base, destInner, true));
    }
    try {
      const buf = this.dofs.read(fsPathOf(innerPath), {});
      await this.dofs.writeFile(fsPathOf(destInner), buf.slice(0), {});
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    this.copyMeta(innerPath, destInner, false);
    return destExists ? new Response(null, { status: 204 }) : createdResponse(hrefOf(base, destInner, false));
  }

  private copyMeta(from: string, to: string, isCollection: boolean): void {
    try {
      const sql = this.sql();
      const rows = sql.exec(`SELECT content_type, etag FROM dav_nodes WHERE path = ?`, from).toArray();
      const row = rows[0];
      const now = Date.now();
      sql.exec(
        `INSERT INTO dav_nodes (path, is_collection, content_type, etag, mtime, crtime) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET is_collection=excluded.is_collection, content_type=excluded.content_type, etag=excluded.etag, mtime=excluded.mtime`,
        to,
        isCollection ? 1 : 0,
        row?.['content_type'] ?? null,
        row?.['etag'] ?? null,
        now,
        now,
      );
      const props = sql.exec(`SELECT namespace_uri, local_name, prefix, value_xml FROM dav_props WHERE path = ?`, from).toArray();
      for (const p of props) {
        sql.exec(
          `INSERT INTO dav_props (path, namespace_uri, local_name, prefix, value_xml) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path, namespace_uri, local_name) DO UPDATE SET prefix=excluded.prefix, value_xml=excluded.value_xml`,
          to,
          String(p['namespace_uri'] ?? ''),
          String(p['local_name'] ?? ''),
          p['prefix'] == null ? null : String(p['prefix']),
          String(p['value_xml'] ?? ''),
        );
      }
      // locks are NOT copied (per RFC)
    } catch {
      // ignore
    }
  }

  private async handleMove(request: Request, innerPath: string, base: string): Promise<Response> {
    const destHeader = request.headers.get('Destination');
    if (!destHeader) return new Response('Bad Request', { status: 400 });
    const destFull = parseDestinationPath(destHeader, request.url);
    if (destFull === null) return new Response('Bad Request', { status: 400 });
    const destInner = this.stripBase(destFull, base);
    if (destInner === null) return new Response('Bad Request', { status: 400 });
    if (isSameOrDescendantPath(innerPath, destInner)) return new Response('Bad Request', { status: 400 });
    const srcLock = this.assertLock(request, innerPath);
    if (srcLock) return srcLock;
    const dstLock = this.assertLock(request, destInner);
    if (dstLock) return dstLock;
    const srcStat = this.statInner(innerPath);
    if (!srcStat.exists) return new Response('Not Found', { status: 404 });
    const destParent = getParentPath(destInner);
    if (destParent !== '' && !this.statInner(destParent).isDirectory) return new Response('Conflict', { status: 409 });
    const overwrite = (request.headers.get('Overwrite') ?? 'T') !== 'F';
    const destExists = this.statInner(destInner).exists;
    if (!overwrite && destExists) return new Response('Precondition Failed', { status: 412 });
    if (destExists) {
      const del = await this.handleDelete(
        new Request(request.url, { method: 'DELETE', headers: this.forwardLockHeaders(request) }),
        destInner,
        base,
      );
      if (!del.ok && del.status !== 204) return del;
    }
    try {
      this.dofs.rename(fsPathOf(innerPath), fsPathOf(destInner));
    } catch {
      return new Response('Internal Server Error', { status: 500 });
    }
    try {
      const sql = this.sql();
      const fromPrefix = `${innerPath}/`;
      const toPrefix = `${destInner}/`;
      // rename node + props + preserve locks on source path (MOVE preserves locks per r2-webdav getPreservedCustomMetadata)
      sql.exec(`UPDATE dav_nodes SET path = ? || SUBSTR(path, ?) WHERE path = ? OR path LIKE ?`, destInner, innerPath.length + 1, innerPath, `${fromPrefix}%`);
      sql.exec(`UPDATE dav_props SET path = ? || SUBSTR(path, ?) WHERE path = ? OR path LIKE ?`, destInner, innerPath.length + 1, innerPath, `${fromPrefix}%`);
      sql.exec(`UPDATE dav_locks SET path = ? || SUBSTR(path, ?) WHERE path = ? OR path LIKE ?`, destInner, innerPath.length + 1, innerPath, `${fromPrefix}%`);
      void toPrefix;
    } catch {
      // ignore
    }
    return destExists ? new Response(null, { status: 204 }) : createdResponse(hrefOf(base, destInner, srcStat.isDirectory));
  }

  private forwardLockHeaders(request: Request): Headers {
    const h = new Headers();
    for (const k of ['If', 'Lock-Token']) {
      const v = request.headers.get(k);
      if (v) h.set(k, v);
    }
    return h;
  }

  private stripBase(full: string, base: string): string | null {
    // full is decoded path without leading slash? parseDestinationPath returns decoded without leading slash, but includes owner/volume prefix
    // base is /owner/volume
    const baseTrim = stripSlashes(base);
    if (full === baseTrim) return '';
    if (full.startsWith(`${baseTrim}/`)) return full.slice(baseTrim.length + 1);
    // fallback: if full has no volume prefix (direct DO call), treat as inner
    if (!full.includes('/')) return full;
    const parts = full.split('/');
    if (parts.length >= 2 && `${parts[0]}/${parts[1]}`.toLowerCase() === baseTrim.toLowerCase()) {
      return parts.slice(2).join('/');
    }
    return null;
  }

  private async handleLock(request: Request, innerPath: string, base: string): Promise<Response> {
    const depthHeader = request.headers.get('Depth');
    if (depthHeader !== null && depthHeader !== '0' && depthHeader !== 'infinity') {
      return new Response('Bad Request', { status: 400 });
    }
    const { timeout, expiresAt } = parseTimeout(request.headers.get('Timeout'));
    const body = await request.text();
    const requestedScope = /<shared\b/i.test(body) ? 'shared' : 'exclusive';
    if (body !== '' && !/<write\b/i.test(body)) return new Response('Bad Request', { status: 400 });
    const owner = extractLockOwner(body);
    const lockCheck = this.assertLock(request, innerPath, {
      ignoreSharedOnTarget: body !== '' && requestedScope === 'shared',
    });
    if (lockCheck) return lockCheck;

    const sql = this.sql();
    // refresh?
    let existing: LockDetails | undefined;
    let resourceExists = this.statInner(innerPath).exists;
    if (body === '') {
      const tokens = getRequestLockTokens(request);
      for (let cur = innerPath; ; cur = getParentPath(cur)) {
        try {
          const rows = sql.exec(`SELECT token, scope, depth, owner, timeout, expires_at as expiresAt, root FROM dav_locks WHERE path = ? AND expires_at > ?`, cur, Date.now()).toArray();
          const found = rows.find((r) => tokens.includes(String(r['token'] ?? '')) && (cur === innerPath || String(r['depth']) === 'infinity'));
          if (found) {
            const normalized = normalizeLockDetails({
              token: String(found['token']),
              owner: found['owner'] == null ? undefined : String(found['owner']),
              scope: found['scope'] === 'shared' ? 'shared' : 'exclusive',
              depth: found['depth'] === 'infinity' ? 'infinity' : '0',
              timeout: String(found['timeout'] ?? ''),
              expiresAt: Number(found['expiresAt'] ?? 0),
              root: String(found['root'] ?? '/'),
            });
            if (normalized && resourceExists) {
              existing = normalized;
              // refresh must target the lock's path; if ancestor lock, use it
              if (cur !== innerPath) {
                // ancestor infinity lock refresh: update that row
                innerPath = cur;
              }
              break;
            }
          }
        } catch {
          // ignore
        }
        if (cur === '') break;
      }
      if (!existing && resourceExists) {
        // check target has locks but token didn't match -> 423 (already handled by assertLock? keep parity)
        try {
          const rows = sql.exec(`SELECT token FROM dav_locks WHERE path = ? AND expires_at > ?`, innerPath, Date.now()).toArray();
          if (rows.length > 0 && rows.every((r) => !tokens.includes(String(r['token'] ?? '')))) {
            return new Response('Locked', { status: 423 });
          }
        } catch {
          // ignore
        }
      }
    }

    if (!resourceExists) {
      if (body === '') return new Response('Bad Request', { status: 400 });
      const parent = getParentPath(innerPath);
      if (parent !== '' && !this.statInner(parent).isDirectory) return new Response('Conflict', { status: 409 });
      if (request.url.endsWith('/')) return new Response('Conflict', { status: 409 });
      try {
        await this.dofs.writeFile(fsPathOf(innerPath), new Uint8Array().buffer, {});
      } catch {
        return new Response('Conflict', { status: 409 });
      }
      const now = Date.now();
      try {
        sql.exec(`INSERT INTO dav_nodes (path, is_collection, mtime, crtime) VALUES (?, 0, ?, ?) ON CONFLICT(path) DO NOTHING`, innerPath, now, now);
      } catch {
        // ignore
      }
      resourceExists = true;
    }
    if (!resourceExists) return new Response('Not Found', { status: 404 });

    let current: LockDetails[] = [];
    try {
      const rows = sql.exec(`SELECT token, scope, depth, owner, timeout, expires_at as expiresAt, root FROM dav_locks WHERE path = ? AND expires_at > ?`, innerPath, Date.now()).toArray();
      current = rows.flatMap((r) => {
        const n = normalizeLockDetails({
          token: String(r['token'] ?? ''),
          owner: r['owner'] == null ? undefined : String(r['owner']),
          scope: r['scope'] === 'shared' ? 'shared' : 'exclusive',
          depth: r['depth'] === 'infinity' ? 'infinity' : '0',
          timeout: String(r['timeout'] ?? ''),
          expiresAt: Number(r['expiresAt'] ?? 0),
          root: String(r['root'] ?? '/'),
        });
        return n ? [n] : [];
      });
    } catch {
      current = [];
    }

    if (!existing) {
      if (requestedScope === 'exclusive' && current.length > 0) return new Response('Locked', { status: 423 });
      if (requestedScope === 'shared' && current.some((l) => l.scope === 'exclusive')) return new Response('Locked', { status: 423 });
    }

    let depth: '0' | 'infinity';
    if (existing && depthHeader === null && body === '') {
      depth = existing.depth;
    } else {
      const isCollection = this.statInner(innerPath).isDirectory;
      depth = determineLockDepth(isCollection, depthHeader);
    }

    const details: LockDetails = {
      token: existing?.token ?? crypto.randomUUID(),
      owner: owner ?? existing?.owner,
      scope: existing?.scope ?? requestedScope,
      depth,
      timeout,
      expiresAt,
      root: hrefOf(base, innerPath, this.statInner(innerPath).isDirectory),
    };
    try {
      if (existing) {
        sql.exec(`UPDATE dav_locks SET scope=?, depth=?, owner=?, timeout=?, expires_at=?, root=? WHERE token=?`, details.scope, details.depth, details.owner ?? null, details.timeout, details.expiresAt, details.root, details.token);
      } else {
        sql.exec(`INSERT INTO dav_locks (token, path, scope, depth, owner, timeout, expires_at, root) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, details.token, innerPath, details.scope, details.depth, details.owner ?? null, details.timeout, details.expiresAt, details.root);
      }
    } catch {
      return new Response('Internal Server Error', { status: 500 });
    }
    let updated: LockDetails[] = [];
    try {
      const rows = sql.exec(`SELECT token, scope, depth, owner, timeout, expires_at as expiresAt, root FROM dav_locks WHERE path = ? AND expires_at > ?`, innerPath, Date.now()).toArray();
      updated = rows.flatMap((r) => {
        const n = normalizeLockDetails({
          token: String(r['token'] ?? ''),
          owner: r['owner'] == null ? undefined : String(r['owner']),
          scope: r['scope'] === 'shared' ? 'shared' : 'exclusive',
          depth: r['depth'] === 'infinity' ? 'infinity' : '0',
          timeout: String(r['timeout'] ?? ''),
          expiresAt: Number(r['expiresAt'] ?? 0),
          root: String(r['root'] ?? '/'),
        });
        return n ? [n] : [];
      });
    } catch {
      updated = [details];
    }
    return new Response(
      `<?xml version="1.0" encoding="utf-8"?>\n<prop xmlns="DAV:"><lockdiscovery>${getLockDiscovery(updated)}</lockdiscovery></prop>`,
      {
        status: existing ? 200 : 201,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Lock-Token': `<urn:uuid:${details.token}>`,
        },
      },
    );
  }

  private async handleUnlock(request: Request, innerPath: string, _base: string): Promise<Response> {
    const st = this.statInner(innerPath);
    if (!st.exists && innerPath !== '') return new Response('Not Found', { status: 404 });
    const lockToken = request.headers.get('Lock-Token');
    if (!lockToken) return new Response('Bad Request', { status: 400 });
    const locked = this.assertLock(request, innerPath);
    if (locked) return locked;
    const normalized = normalizeLockToken(lockToken);
    const sql = this.sql();
    try {
      const rows = sql.exec(`SELECT token FROM dav_locks WHERE path = ? AND token = ?`, innerPath, normalized).toArray();
      // also allow opaquelocktoken/urn prefix variants already normalized
      if (rows.length === 0) {
        // check by suffix match (token stored raw uuid)
        const all = sql.exec(`SELECT token FROM dav_locks WHERE path = ?`, innerPath).toArray();
        if (all.every((r) => !(normalizeLockToken(String(r['token'] ?? '')) === normalized || String(r['token']) === normalized))) {
          return new Response('Conflict', { status: 409 });
        }
      }
      sql.exec(`DELETE FROM dav_locks WHERE path = ? AND (token = ? OR token LIKE ?)`, innerPath, normalized, `%${normalized}%`);
      // fallback exact normalized delete
      try {
        sql.exec(`DELETE FROM dav_locks WHERE token = ?`, normalized);
      } catch {
        // ignore
      }
    } catch {
      return new Response('Conflict', { status: 409 });
    }
    return new Response(null, { status: 204 });
  }

  public async setVolumeKey(volumeKey: string): Promise<void> {
    try {
      await this.ctx.storage.put('volumeKey', volumeKey);
    } catch {
      // ignore
    }
  }

  public async deleteVolume(): Promise<void> {
    try {
      this.dofs.rmdir('/', { recursive: true });
    } catch {
      // ignore
    }
    try {
      const sql = this.sql();
      sql.exec(`DELETE FROM dav_nodes`);
      sql.exec(`DELETE FROM dav_props`);
      sql.exec(`DELETE FROM dav_locks`);
    } catch {
      // ignore
    }
    try {
      await this.ctx.storage.delete('volumeKey');
    } catch {
      // ignore
    }
  }
}

export { DavVolumeWorker };
