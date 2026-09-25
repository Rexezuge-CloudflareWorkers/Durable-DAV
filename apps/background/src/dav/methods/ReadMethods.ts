/* eslint-disable @typescript-eslint/require-await -- WebDAV read handlers keep async for uniform dispatch. */
import type { DofsFs } from '@durable-dav/dav-store';
import { escapeXml } from '@durable-dav/webdav';
import { fsPathOf, hrefOf } from '../DavContext';
import { parseRangeHeader } from '../RangeParser';
import type { DavRepository } from '../DavRepository';

// Collection HTML browser + file byte serving (Command: one handler per
// WebDAV method family so `DavVolumeWorker` stays a thin Facade).
function renderCollectionHtml(base: string, innerPath: string, children: Array<{ name: string; childInner: string; isDirectory: boolean }>): string {
  let items = '';
  if (innerPath !== '') items += `<a href="../">..</a><br>`;
  for (const child of children) {
    const href = hrefOf(base, child.childInner, child.isDirectory);
    items += `<a href="${escapeXml(href)}">${escapeXml(child.name)}${child.isDirectory ? '/' : ''}</a><br>`;
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Durable-DAV</title><style>*{box-sizing:border-box}body{padding:10px;font-family:system-ui,sans-serif}a{display:inline-block;width:100%;color:#000;text-decoration:none;padding:5px 10px;border-radius:5px}a:hover{background:#0ea5e9;color:#fff}</style></head><body><h1>Durable-DAV ${escapeXml(base)}/${escapeXml(innerPath)}</h1><div>${items}</div></body></html>`;
}

async function handleGet(
  request: Request,
  innerPath: string,
  base: string,
  headOnly: boolean,
  repo: DavRepository,
  dofs: DofsFs,
): Promise<Response> {
  const st = repo.statInner(innerPath);
  const isBrowserNav = request.url.endsWith('/') || innerPath === '' || st.isDirectory;
  if (isBrowserNav) {
    if (innerPath !== '' && (!st.exists || !st.isDirectory)) return new Response('Not Found', { status: 404 });
    if (headOnly) return new Response(null, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const children = repo.listChildren(innerPath).map((name) => {
      const childInner = repo.childInner(innerPath, name);
      return { name, childInner, isDirectory: repo.statInner(childInner).isDirectory };
    });
    return new Response(renderCollectionHtml(base, innerPath, children), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  if (!st.exists) return new Response('Not Found', { status: 404 });
  const meta = repo.readMeta(innerPath);
  const { offset, length, contentRange, status } = parseRangeHeader(request.headers.get('Range'), st.size);
  let body: ReadableStream | ArrayBuffer;
  let contentLength = st.size;
  try {
    if (length === undefined) {
      body = dofs.readFile(fsPathOf(innerPath), {});
    } else {
      const buf = dofs.read(fsPathOf(innerPath), { offset, length });
      body = buf;
      contentLength = buf.byteLength;
    }
  } catch {
    return new Response('Not Found', { status: 404 });
  }
  const contentType = meta.contentType ?? 'application/octet-stream';
  if (headOnly) {
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(contentLength),
      'Accept-Ranges': 'bytes',
    };
    if (meta.etag) headers['ETag'] = meta.etag;
    return new Response(null, { status: 200, headers });
  }
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(contentLength),
    'Accept-Ranges': 'bytes',
  };
  if (meta.etag) headers['ETag'] = meta.etag;
  if (contentRange) headers['Content-Range'] = contentRange;
  return new Response(body as BodyInit, { status, headers });
}

export { handleGet, renderCollectionHtml };
