/* eslint-disable @typescript-eslint/require-await -- WebDAV write handlers keep async for uniform dispatch. */
import type { DofsFs } from '@durable-dav/dav-store';
import { MAX_XML_BODY_BYTES, getParentPath, getRequestLockTokens, readCappedBody } from '@durable-dav/webdav';
import { fsPathOf } from '../DavContext';
import type { DavLockGuard } from '../DavLockGuard';
import type { DavRepository } from '../DavRepository';

async function handlePut(
  request: Request,
  innerPath: string,
  repo: DavRepository,
  locks: DavLockGuard,
  dofs: DofsFs,
  maxFileBytes: number,
): Promise<Response> {
  // The resource type comes from the request target, not `isDirectory`:
  // `PUT /a/b/` for a *file* named `b` is a 404 (no such collection), and
  // `PUT /` on the root is a 405.
  if (innerPath === '' || request.url.endsWith('/')) return new Response('Method Not Allowed', { status: 405 });
  const locked = locks.assertLock(request, innerPath);
  if (locked) return locked;
  const parent = getParentPath(innerPath);
  if (parent !== '' && !repo.statInner(parent).isDirectory) return new Response('Conflict', { status: 409 });
  const existing = repo.statInner(innerPath);
  if (existing.exists && existing.isDirectory) return new Response('Method Not Allowed', { status: 405 });
  // Streaming cap, not a post-hoc check: an oversize body is refused without
  // ever being fully buffered.
  const body = await readCappedBody(request, maxFileBytes);
  if (!body.ok) return new Response('Payload Too Large', { status: 413 });
  const bytes = new Uint8Array(body.bytes);
  try {
    await dofs.writeFile(fsPathOf(innerPath), bytes.slice().buffer, {});
  } catch {
    return new Response('Insufficient Storage', { status: 507 });
  }
  const contentType = request.headers.get('Content-Type') ?? 'application/octet-stream';
  const now = Date.now();
  const prev = repo.readMeta(innerPath);
  repo.upsertFileNode(innerPath, contentType, `"${bytes.byteLength.toString(16)}-${now.toString(16)}"`, now, prev.crtime ?? now);
  return existing.exists ? new Response(null, { status: 204 }) : new Response('', { status: 201 });
}

async function handleDelete(
  request: Request,
  innerPath: string,
  repo: DavRepository,
  locks: DavLockGuard,
  dofs: DofsFs,
): Promise<Response> {
  if (innerPath === '') return new Response('Forbidden', { status: 403 });
  const st = repo.statInner(innerPath);
  if (!st.exists) return new Response('Not Found', { status: 404 });
  const locked = locks.assertLock(request, innerPath);
  if (locked) return locked;
  if (st.isDirectory) {
    const tokens = getRequestLockTokens(request);
    for (const name of repo.listRecursive(innerPath)) {
      const childInner = repo.childInner(innerPath, name);
      if (locks.activeTokensForPath(childInner, tokens).length > 0) {
        return new Response('Locked', { status: 423 });
      }
    }
    try {
      dofs.rmdir(fsPathOf(innerPath), { recursive: true });
    } catch {
      return new Response('Internal Server Error', { status: 500 });
    }
    repo.deleteCascade(innerPath);
    return new Response(null, { status: 204 });
  }
  try {
    dofs.unlink(fsPathOf(innerPath));
  } catch {
    return new Response('Not Found', { status: 404 });
  }
  repo.deleteCascade(innerPath);
  return new Response(null, { status: 204 });
}

async function handleMkcol(
  request: Request,
  innerPath: string,
  repo: DavRepository,
  locks: DavLockGuard,
  dofs: DofsFs,
): Promise<Response> {
  // RFC 4918 §9.3.1: a body makes the request unsupported. `request.clone()`
  // used to tee the stream so the full payload was buffered twice just to
  // discover it was non-empty.
  const probe = await readCappedBody(request, MAX_XML_BODY_BYTES);
  if (!probe.ok) return new Response('Payload Too Large', { status: 413 });
  if (probe.bytes.byteLength > 0) return new Response('Unsupported Media Type', { status: 415 });
  if (innerPath === '') return new Response('Method Not Allowed', { status: 405 });
  const locked = locks.assertLock(request, innerPath);
  if (locked) return locked;
  if (repo.statInner(innerPath).exists) return new Response('Method Not Allowed', { status: 405 });
  const parent = getParentPath(innerPath);
  if (parent !== '' && !repo.statInner(parent).isDirectory) return new Response('Conflict', { status: 409 });
  try {
    dofs.mkdir(fsPathOf(innerPath), { recursive: false });
  } catch {
    return new Response('Conflict', { status: 409 });
  }
  repo.upsertCollectionNode(innerPath, Date.now());
  return new Response('', { status: 201 });
}

export { handlePut, handleDelete, handleMkcol };
