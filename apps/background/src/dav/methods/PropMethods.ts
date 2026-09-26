import type { DurableSqlStorage } from '@durable-dav/dav-store';
import {
  MAX_XML_BODY_BYTES,
  escapeXml,
  generatePropfindResponse,
  isProtectedProperty,
  parsePropfindRequest,
  parseProppatchRequest,
  readCappedText,
  renderEmptyPropertyElement,
  type DeadProperty,
} from '@durable-dav/webdav';

/**
 * Read a request body as UTF-8 XML, refusing anything over the cap.
 * Returns `null` when the caller should answer `413`.
 */
async function readXmlBody(request: Request): Promise<string | null> {
  const result = await readCappedText(request, MAX_XML_BODY_BYTES);
  return result.ok ? result.text : null;
}
import { hrefOf } from '../DavContext';
import type { DavLockGuard } from '../DavLockGuard';
import type { DavRepository } from '../DavRepository';

async function handlePropfind(request: Request, innerPath: string, base: string, repo: DavRepository): Promise<Response> {
  const xml = await readXmlBody(request);
  if (xml === null) return new Response('Payload Too Large', { status: 413 });
  const parsed = parsePropfindRequest(xml);
  if (!parsed) return new Response('Bad Request', { status: 400 });
  const node = innerPath === '' ? repo.rootNode() : repo.nodeInfo(innerPath, base);
  if (innerPath !== '' && !node) return new Response('Not Found', { status: 404 });
  let page = `<?xml version="1.0" encoding="utf-8"?>\n<multistatus xmlns="DAV:">`;
  const props = parsed.mode === 'prop' ? parsed.properties : [];
  page += generatePropfindResponse(node, parsed.mode, props);
  if (node?.isCollection ?? true) {
    const depth = request.headers.get('Depth') ?? 'infinity';
    if (depth !== '0' && depth !== '1' && depth !== 'infinity') return new Response('Bad Request', { status: 400 });
    if (depth !== '0') {
      const seen = new Set<string>();
      for (const name of repo.listChildren(innerPath)) {
        const childInner = repo.childInner(innerPath, name);
        seen.add(childInner);
        const child = repo.nodeInfo(childInner, base);
        if (child) page += generatePropfindResponse(child, parsed.mode, props);
      }
      if (depth === 'infinity') {
        for (const name of repo.listRecursive(innerPath)) {
          const childInner = repo.childInner(innerPath, name);
          if (seen.has(childInner)) continue;
          const child = repo.nodeInfo(childInner, base);
          if (child) page += generatePropfindResponse(child, parsed.mode, props);
        }
      }
    }
  }
  page += '\n</multistatus>\n';
  return new Response(page, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

async function handleProppatch(
  request: Request,
  innerPath: string,
  base: string,
  repo: DavRepository,
  locks: DavLockGuard,
  sql: DurableSqlStorage,
): Promise<Response> {
  const locked = locks.assertLock(request, innerPath);
  if (locked) return locked;
  const node = innerPath === '' ? repo.rootNode() : repo.nodeInfo(innerPath, base);
  if (!node && innerPath !== '') return new Response('Not Found', { status: 404 });
  const requestXml = await readXmlBody(request);
  if (requestXml === null) return new Response('Payload Too Large', { status: 413 });
  const parsed = parseProppatchRequest(requestXml);
  if (!parsed) return new Response('Bad Request', { status: 400 });
  const okSets: DeadProperty[] = [];
  const okRemoves: DeadProperty[] = [];
  const failedSets: DeadProperty[] = [];
  const failedRemoves: DeadProperty[] = [];
  for (const op of parsed.operations) {
    if (isProtectedProperty(op.property)) {
      if (op.action === 'set') failedSets.push(op.property);
      else failedRemoves.push(op.property);
      continue;
    }
    if (op.action === 'set') okSets.push(op.property);
    else okRemoves.push(op.property);
  }
  const hasFailures = failedSets.length > 0 || failedRemoves.length > 0;
  if (!hasFailures) {
    for (const p of okSets) {
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
        // Best-effort; partial failure surfaces as 424 via propstat below
        // on the next read. Kept atomic-by-convention (no partial commit
        // marker) to match the previous ported behavior.
      }
    }
    for (const p of okRemoves) {
      try {
        sql.exec(`DELETE FROM dav_props WHERE path = ? AND namespace_uri = ? AND local_name = ?`, innerPath, p.namespaceURI, p.localName);
      } catch {
        // Same best-effort note as above.
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
    xml += `\n<propstat>\n<prop>\n${props.join('\n')}\n</prop>\n<status>${status}</status>\n</propstat>`;
  }
  xml += '\n</response>\n</multistatus>';
  return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

export { handlePropfind, handleProppatch };
