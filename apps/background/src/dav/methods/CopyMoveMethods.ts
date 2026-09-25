import type { DofsFs } from '@durable-dav/dav-store';
import { createdResponse, getParentPath, isSameOrDescendantPath, parseDestinationPath } from '@durable-dav/webdav';
import { fsPathOf, hrefOf, stripBase } from '../DavContext';
import type { DavLockGuard } from '../DavLockGuard';
import type { DavRepository } from '../DavRepository';

function forwardLockHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const key of ['If', 'Lock-Token']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  return headers;
}

async function handleCopy(
  request: Request,
  innerPath: string,
  base: string,
  repo: DavRepository,
  locks: DavLockGuard,
  dofs: DofsFs,
  removeDestination: (destInner: string) => Promise<Response | null>,
): Promise<Response> {
  const destHeader = request.headers.get('Destination');
  if (!destHeader) return new Response('Bad Request', { status: 400 });
  const destFull = parseDestinationPath(destHeader, request.url);
  if (destFull === null) return new Response('Bad Request', { status: 400 });
  const destInner = stripBase(destFull, base);
  if (destInner === null) return new Response('Bad Request', { status: 400 });
  if (isSameOrDescendantPath(innerPath, destInner)) return new Response('Bad Request', { status: 400 });
  const locked = locks.assertLock(request, destInner);
  if (locked) return locked;
  const srcStat = repo.statInner(innerPath);
  if (!srcStat.exists) return new Response('Not Found', { status: 404 });
  const destParent = getParentPath(destInner);
  if (destParent !== '' && !repo.statInner(destParent).isDirectory) return new Response('Conflict', { status: 409 });
  const overwrite = request.headers.get('Overwrite') !== 'F';
  const destExists = repo.statInner(destInner).exists;
  if (!overwrite && destExists) return new Response('Precondition Failed', { status: 412 });
  if (destExists) {
    const removed = await removeDestination(destInner);
    if (removed) return removed;
  }
  if (srcStat.isDirectory) {
    const depth = request.headers.get('Depth') ?? 'infinity';
    if (depth !== '0' && depth !== 'infinity') return new Response('Bad Request', { status: 400 });
    try {
      dofs.mkdir(fsPathOf(destInner), { recursive: false });
    } catch {
      if (!destExists) return new Response('Conflict', { status: 409 });
    }
    repo.copyMeta(innerPath, destInner, true);
    if (depth === 'infinity') {
      for (const name of repo.listRecursive(innerPath)) {
        const srcChild = repo.childInner(innerPath, name);
        const rel = srcChild.slice(innerPath.length + 1);
        const dstChild = `${destInner}/${rel}`;
        const childStat = repo.statInner(srcChild);
        if (childStat.isDirectory) {
          try {
            dofs.mkdir(fsPathOf(dstChild), { recursive: false });
          } catch {
            // Best-effort; metadata copy below still records the collection.
          }
        } else {
          try {
            const buf = dofs.read(fsPathOf(srcChild), {});
            await dofs.writeFile(fsPathOf(dstChild), buf.slice(0), {});
          } catch {
            continue;
          }
        }
        repo.copyMeta(srcChild, dstChild, childStat.isDirectory);
      }
    }
    return destExists ? new Response(null, { status: 204 }) : createdResponse(hrefOf(base, destInner, true));
  }
  try {
    const buf = dofs.read(fsPathOf(innerPath), {});
    await dofs.writeFile(fsPathOf(destInner), buf.slice(0), {});
  } catch {
    return new Response('Not Found', { status: 404 });
  }
  repo.copyMeta(innerPath, destInner, false);
  return destExists ? new Response(null, { status: 204 }) : createdResponse(hrefOf(base, destInner, false));
}

async function handleMove(
  request: Request,
  innerPath: string,
  base: string,
  repo: DavRepository,
  locks: DavLockGuard,
  dofs: DofsFs,
  deleteForMove: (destInner: string, req: Request) => Promise<Response | null>,
): Promise<Response> {
  const destHeader = request.headers.get('Destination');
  if (!destHeader) return new Response('Bad Request', { status: 400 });
  const destFull = parseDestinationPath(destHeader, request.url);
  if (destFull === null) return new Response('Bad Request', { status: 400 });
  const destInner = stripBase(destFull, base);
  if (destInner === null) return new Response('Bad Request', { status: 400 });
  if (isSameOrDescendantPath(innerPath, destInner)) return new Response('Bad Request', { status: 400 });
  const srcLock = locks.assertLock(request, innerPath);
  if (srcLock) return srcLock;
  const dstLock = locks.assertLock(request, destInner);
  if (dstLock) return dstLock;
  const srcStat = repo.statInner(innerPath);
  if (!srcStat.exists) return new Response('Not Found', { status: 404 });
  const destParent = getParentPath(destInner);
  if (destParent !== '' && !repo.statInner(destParent).isDirectory) return new Response('Conflict', { status: 409 });
  const overwrite = (request.headers.get('Overwrite') ?? 'T') !== 'F';
  const destExists = repo.statInner(destInner).exists;
  if (!overwrite && destExists) return new Response('Precondition Failed', { status: 412 });
  if (destExists) {
    const removed = await deleteForMove(
      destInner,
      new Request(request.url, { method: 'DELETE', headers: forwardLockHeaders(request) }),
    );
    if (removed) return removed;
  }
  try {
    dofs.rename(fsPathOf(innerPath), fsPathOf(destInner));
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }
  // MOVE preserves locks (RFC 4918 §9.9); COPY does not.
  repo.renameCascade(innerPath, destInner);
  return destExists ? new Response(null, { status: 204 }) : createdResponse(hrefOf(base, destInner, srcStat.isDirectory));
}

export { handleCopy, handleMove };
