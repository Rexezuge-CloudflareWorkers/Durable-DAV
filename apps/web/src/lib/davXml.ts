import type { DavEntry } from '../types';

function stripSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start += 1;
  while (end > start && value[end - 1] === '/') end -= 1;
  return value.slice(start, end);
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

// WebDAV servers may prefix element names (`D:href`, `d:href`, or bare
// `href`). Collapsing prefixes up front keeps the scanners below plain
// substring searches instead of namespace-aware regular expressions.
function stripNamespacePrefixes(xml: string): string {
  return xml.replaceAll(/<(\/?)[a-z][\w.-]*:/gi, '<$1');
}

function stripTags(value: string): string {
  let out = '';
  let inTag = false;
  for (const ch of value) {
    if (ch === '<') {
      inTag = true;
      continue;
    }
    if (ch === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }
  return out;
}

function pickTag(block: string, local: string): string | null {
  const exact = `<${local}>`;
  const exactAt = block.indexOf(exact);
  let contentStart: number;
  if (exactAt === -1) {
    // Tolerate attributes on the opening tag (`<href xml:lang="…">`).
    const attrOpen = `<${local} `;
    const attrAt = block.indexOf(attrOpen);
    if (attrAt === -1) return null;
    const gt = block.indexOf('>', attrAt + attrOpen.length);
    if (gt === -1) return null;
    contentStart = gt + 1;
  } else {
    contentStart = exactAt + exact.length;
  }
  const end = block.indexOf(`</${local}>`, contentStart);
  return end === -1 ? null : stripTags(block.slice(contentStart, end)).trim();
}

function splitResponses(xml: string): string[] {
  const out: string[] = [];
  const normalized = stripNamespacePrefixes(xml);
  const chunks = normalized.split('</response>');
  for (const chunk of chunks) {
    const openAt = chunk.indexOf('<response');
    if (openAt === -1) continue;
    const gt = chunk.indexOf('>', openAt);
    if (gt === -1) continue;
    out.push(chunk.slice(gt + 1));
  }
  return out;
}

/**
 * Parses an RFC 4918 `207 multistatus` body into directory entries.
 * Namespace-prefix agnostic (`D:`, `d:`, or none) so it stays robust across
 * server renderers. The `basePath` is the inner path that was listed (used
 * to drop the self-response and to derive child names).
 */
export function parseMultistatus(xml: string, basePath: string): DavEntry[] {
  const normalizedBase = stripSlashes(basePath);
  const entries: DavEntry[] = [];
  for (const block of splitResponses(xml)) {
    const rawHref = pickTag(block, 'href');
    if (!rawHref) continue;
    // Server hrefs are root-relative inner paths (`/`, `/child`, `/dir/`).
    let hrefPath = decodeHref(rawHref);
    const queryAt = hrefPath.indexOf('?');
    if (queryAt !== -1) hrefPath = hrefPath.slice(0, queryAt);
    try {
      // Tolerate absolute URLs too.
      if (hrefPath.startsWith('http://') || hrefPath.startsWith('https://')) {
        hrefPath = new URL(hrefPath).pathname;
      }
    } catch {
      // keep raw
    }
    hrefPath = stripSlashes(hrefPath);
    // Skip the self response (the listed collection itself).
    if (hrefPath === normalizedBase) continue;

    const isCollection = block.includes('<collection');
    const sizeText = pickTag(block, 'getcontentlength');
    const size = sizeText === null || sizeText === '' ? null : Number(sizeText);
    const slashAt = hrefPath.lastIndexOf('/');
    const name = slashAt === -1 ? hrefPath : hrefPath.slice(slashAt + 1);
    entries.push({
      href: rawHref,
      name,
      path: hrefPath,
      isCollection,
      size: size !== null && Number.isFinite(size) ? size : null,
      contentType: pickTag(block, 'getcontenttype'),
      lastModified: pickTag(block, 'getlastmodified'),
      etag: pickTag(block, 'getetag'),
    });
  }
  // Deterministic order: collections first, then case-insensitive name.
  entries.sort((a, b) => {
    if (a.isCollection !== b.isCollection) return a.isCollection ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return entries;
}

export function joinDavPath(base: string, name: string): string {
  const clean = stripSlashes(base);
  const leaf = stripSlashes(name);
  return clean === '' ? leaf : `${clean}/${leaf}`;
}

export function parentDavPath(path: string): string | null {
  const clean = stripSlashes(path);
  if (clean === '') return null;
  const index = clean.lastIndexOf('/');
  return index === -1 ? '' : clean.slice(0, index);
}

export { stripSlashes };
