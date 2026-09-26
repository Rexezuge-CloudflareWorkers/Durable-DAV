/* eslint-disable @typescript-eslint/no-base-to-string -- DO SQLite rows are primitives (TEXT/INTEGER); Record<string, unknown> trips the object-stringification guard. */
/* eslint-disable @typescript-eslint/require-await -- WebDAV LOCK handlers keep async for uniform dispatch. */
import type { DurableSqlStorage } from '@durable-dav/dav-store';
import { MAX_XML_BODY_BYTES, determineLockDepth, extractLockOwner, getLockDiscovery, getParentPath, getRequestLockTokens, normalizeLockDetails, normalizeLockToken, parseTimeout, readCappedText, type LockDetails } from '@durable-dav/webdav';
import { hrefOf } from '../DavContext';
import type { DavLockGuard } from '../DavLockGuard';
import type { DavRepository } from '../DavRepository';

interface LockMethodDeps {
  repo: DavRepository;
  locks: DavLockGuard;
  sql: DurableSqlStorage;
  writeEmptyFile: (innerPath: string) => Promise<boolean>;
  statIsDirectory: (innerPath: string) => boolean;
}

function readLocks(sql: DurableSqlStorage, innerPath: string): LockDetails[] {
  try {
    const rows = sql.exec(`SELECT token, scope, depth, owner, timeout, expires_at as expiresAt, root FROM dav_locks WHERE path = ? AND expires_at > ?`, innerPath, Date.now()).toArray();
    return rows.flatMap((r) => {
      const normalized = normalizeLockDetails({
        token: String(r['token'] ?? ''),
        owner: r['owner'] == null ? undefined : String(r['owner']),
        scope: r['scope'] === 'shared' ? 'shared' : 'exclusive',
        depth: r['depth'] === 'infinity' ? 'infinity' : '0',
        timeout: String(r['timeout'] ?? ''),
        expiresAt: Number(r['expiresAt'] ?? 0),
        root: String(r['root'] ?? '/'),
      });
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

async function handleLock(request: Request, innerPath: string, base: string, deps: LockMethodDeps): Promise<Response> {
  const { repo, locks, sql } = deps;
  const depthHeader = request.headers.get('Depth');
  if (depthHeader !== null && depthHeader !== '0' && depthHeader !== 'infinity') {
    return new Response('Bad Request', { status: 400 });
  }
  const { timeout, expiresAt } = parseTimeout(request.headers.get('Timeout'));
  const rawBody = await readCappedText(request, MAX_XML_BODY_BYTES);
  if (!rawBody.ok) return new Response('Payload Too Large', { status: 413 });
  const body = rawBody.text;
  const requestedScope = /<shared\b/i.test(body) ? 'shared' : 'exclusive';
  if (body !== '' && !/<write\b/i.test(body)) return new Response('Bad Request', { status: 400 });
  const owner = extractLockOwner(body);
  const lockCheck = locks.assertLock(request, innerPath, {
    ignoreSharedOnTarget: body !== '' && requestedScope === 'shared',
  });
  if (lockCheck) return lockCheck;

  let existing: LockDetails | undefined;
  let activePath = innerPath;
  let resourceExists = repo.statInner(innerPath).exists;
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
            activePath = cur;
            break;
          }
        }
      } catch {
        // Best-effort refresh lookup; falls through to 423 handling below.
      }
      if (cur === '') break;
    }
    if (!existing && resourceExists) {
      try {
        const rows = sql.exec(`SELECT token FROM dav_locks WHERE path = ? AND expires_at > ?`, innerPath, Date.now()).toArray();
        if (rows.length > 0 && rows.every((r) => !tokens.includes(String(r['token'] ?? '')))) {
          return new Response('Locked', { status: 423 });
        }
      } catch {
        // Best-effort; `assertLock` above already enforced the precondition.
      }
    }
  }

  if (!resourceExists) {
    if (body === '') return new Response('Bad Request', { status: 400 });
    const parent = getParentPath(innerPath);
    if (parent !== '' && !repo.statInner(parent).isDirectory) return new Response('Conflict', { status: 409 });
    if (request.url.endsWith('/')) return new Response('Conflict', { status: 409 });
    const created = await deps.writeEmptyFile(innerPath);
    if (!created) return new Response('Conflict', { status: 409 });
    resourceExists = true;
  }
  if (!resourceExists) return new Response('Not Found', { status: 404 });

  const current = readLocks(sql, activePath);
  if (!existing) {
    if (requestedScope === 'exclusive' && current.length > 0) return new Response('Locked', { status: 423 });
    if (requestedScope === 'shared' && current.some((l) => l.scope === 'exclusive')) return new Response('Locked', { status: 423 });
  }

  const depth: '0' | 'infinity' =
    existing && depthHeader === null && body === '' ? existing.depth : determineLockDepth(deps.statIsDirectory(activePath), depthHeader);

  const details: LockDetails = {
    token: existing?.token ?? crypto.randomUUID(),
    owner: owner ?? existing?.owner,
    scope: existing?.scope ?? requestedScope,
    depth,
    timeout,
    expiresAt,
    root: hrefOf(base, activePath, deps.statIsDirectory(activePath)),
  };
  try {
    if (existing) {
      sql.exec(`UPDATE dav_locks SET scope=?, depth=?, owner=?, timeout=?, expires_at=?, root=? WHERE token=?`, details.scope, details.depth, details.owner ?? null, details.timeout, details.expiresAt, details.root, details.token);
    } else {
      sql.exec(`INSERT INTO dav_locks (token, path, scope, depth, owner, timeout, expires_at, root) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, details.token, activePath, details.scope, details.depth, details.owner ?? null, details.timeout, details.expiresAt, details.root);
    }
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }
  const updated = readLocks(sql, activePath);
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>\n<prop xmlns="DAV:"><lockdiscovery>${getLockDiscovery(updated.length > 0 ? updated : [details])}</lockdiscovery></prop>`,
    {
      status: existing ? 200 : 201,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Lock-Token': `<urn:uuid:${details.token}>`,
      },
    },
  );
}

async function handleUnlock(request: Request, innerPath: string, deps: LockMethodDeps): Promise<Response> {
  const { repo, locks, sql } = deps;
  const st = repo.statInner(innerPath);
  if (innerPath !== '' && !st.exists) return new Response('Not Found', { status: 404 });
  const lockToken = request.headers.get('Lock-Token');
  if (!lockToken) return new Response('Bad Request', { status: 400 });
  const locked = locks.assertLock(request, innerPath);
  if (locked) return locked;
  const normalized = normalizeLockToken(lockToken);
  try {
    const rows = sql.exec(`SELECT token FROM dav_locks WHERE path = ? AND token = ?`, innerPath, normalized).toArray();
    if (rows.length === 0) {
      const all = sql.exec(`SELECT token FROM dav_locks WHERE path = ?`, innerPath).toArray();
      const matched = all.some((r) => normalizeLockToken(String(r['token'] ?? '')) === normalized || String(r['token']) === normalized);
      if (!matched) return new Response('Conflict', { status: 409 });
    }
    sql.exec(`DELETE FROM dav_locks WHERE path = ? AND (token = ? OR token LIKE ?)`, innerPath, normalized, `%${normalized}%`);
    try {
      sql.exec(`DELETE FROM dav_locks WHERE token = ?`, normalized);
    } catch {
      // Fallback delete is best-effort; path-scoped delete above is authoritative.
    }
  } catch {
    return new Response('Conflict', { status: 409 });
  }
  return new Response(null, { status: 204 });
}

export { handleLock, handleUnlock };
export type { LockMethodDeps };
