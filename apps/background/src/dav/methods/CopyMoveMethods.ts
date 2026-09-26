import type { DofsFs } from '@durable-dav/dav-store';
import { createdResponse, getParentPath, isSameOrDescendantPath, parseDestinationPath } from '@durable-dav/webdav';
import { MAX_PATH_DEPTH, fsPathOf, hrefOf, isValidInnerPath, stripBase } from '../DavContext';
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

// `Overwrite` is case-insensitive per RFC 4918 (`T`/`F`); default is `T`.
function isOverwriteAllowed(request: Request): boolean {
  const raw = request.headers.get('Overwrite');
  return raw === null || raw.trim().toUpperCase() !== 'F';
}

type DestinationResolution = { ok: true; destInner: string } | { ok: false; response: Response };

/**
 * Resolve and validate the `Destination` header for COPY/MOVE.
 *
 * Single source of truth — the preamble was duplicated verbatim in both
 * handlers, which is how the two drifted apart on the checks below.
 *
 * Three things are enforced here that neither handler did on its own:
 *
 * 1. `isValidInnerPath(destInner)`. `Destination` is fully client-controlled
 *    and the front door forwards it verbatim. `parseDestinationPath` does not
 *    normalise `%2e%2e`, so a destination of `.../photos/%2e%2e/%2e%2e/etc`
 *    decoded to `../../etc` and reached `dofs` as a traversal, while
 *    `isSameOrDescendantPath` compared it as an unrelated string and passed.
 * 2. Self/descendant rejection, split from "are they equal". The old single
 *    call used `isSameOrDescendantPath` for both questions, and because that
 *    helper answers "is dest inside src?" with `true` for the volume root, it
 *    also rejected `COPY /alice/photos -> /alice/photos/backup` — a legal and
 *    common "snapshot the bucket" operation (RFC 4918 §9.8.3 only forbids
 *    copying a collection into itself or a descendant).
 * 3. A depth cap, so a pathological destination cannot drive an unbounded
 *    path walk downstream.
 */
function resolveDestination(request: Request, base: string, srcInner: string): DestinationResolution {
  const bad = { ok: false, response: new Response('Bad Request', { status: 400 }) } as const;

  const destHeader = request.headers.get('Destination');
  if (!destHeader) return bad;
  const destFull = parseDestinationPath(destHeader, request.url);
  if (destFull === null) return bad;
  const destInner = stripBase(destFull, base);
  if (destInner === null) return bad;
  if (!isValidInnerPath(destInner)) return bad;
  if (destInner.split('/').length > MAX_PATH_DEPTH) return bad;
  if (destInner === srcInner) return bad;
  return srcInner !== '' && isSameOrDescendantPath(srcInner, destInner) ? bad : { ok: true, destInner };
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
  const destination = resolveDestination(request, base, innerPath);
  if (!destination.ok) return destination.response;
  const { destInner } = destination;
  const locked = locks.assertLock(request, destInner);
  if (locked) return locked;
  const srcStat = repo.statInner(innerPath);
  if (!srcStat.exists) return new Response('Not Found', { status: 404 });
  const destParent = getParentPath(destInner);
  if (destParent !== '' && !repo.statInner(destParent).isDirectory) return new Response('Conflict', { status: 409 });
  const overwrite = isOverwriteAllowed(request);
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
  const destination = resolveDestination(request, base, innerPath);
  if (!destination.ok) return destination.response;
  const { destInner } = destination;
  const srcLock = locks.assertLock(request, innerPath);
  if (srcLock) return srcLock;
  const dstLock = locks.assertLock(request, destInner);
  if (dstLock) return dstLock;
  const srcStat = repo.statInner(innerPath);
  if (!srcStat.exists) return new Response('Not Found', { status: 404 });
  const destParent = getParentPath(destInner);
  if (destParent !== '' && !repo.statInner(destParent).isDirectory) return new Response('Conflict', { status: 409 });
  const overwrite = isOverwriteAllowed(request);
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
