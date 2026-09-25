import { stripSlashes } from '@durable-dav/webdav';

// Pure path helpers shared by every WebDAV method handler (why: the DO
// previously duplicated `fsPathOf`/`hrefOf`/base-stripping inline, which hid
// traversal edge cases and made unit testing impossible).

function fsPathOf(innerPath: string): string {
  return innerPath === '' ? '/' : `/${innerPath}`;
}

function hrefOf(base: string, innerPath: string, isCollection: boolean): string {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  if (innerPath === '') return `${prefix}/`;
  return `${prefix}/${innerPath.split('/').map(encodeURIComponent).join('/')}${isCollection ? '/' : ''}`;
}

/**
Reject `.`/`..`/empty segments so encoded traversal can never escape the volume root.
*/
function isValidInnerPath(innerPath: string): boolean {
  if (innerPath === '') return true;
  const segments = innerPath.split('/');
  return segments.every((s) => s !== '' && s !== '.' && s !== '..');
}

function decodeSegments(path: string): string {
  try {
    return path
      .split('/')
      .map((s) => decodeURIComponent(s))
      .join('/');
  } catch {
    return path;
  }
}

/**
 * Resolve the volume-relative path for a DO request.
 * Prefers the front-door `X-Dav-Path` header; falls back to stripping the
 * `/owner/volume` base prefix from the URL pathname.
 *
 * Both sources are percent-decoded so encoded traversal (`%2e%2e`) is
 * rejected by `isValidInnerPath` instead of slipping into `dofs` as an
 * opaque segment.
 */
function resolveInnerPath(request: Request, url: URL, base: string): string {
  const header = request.headers.get('X-Dav-Path');
  if (header !== null) return decodeSegments(stripSlashes(header));
  const pathname = url.pathname;
  if (base !== '' && pathname.startsWith(base)) {
    return decodeSegments(stripSlashes(pathname.slice(base.length)));
  }
  const parts = stripSlashes(pathname).split('/');
  return parts.length >= 3 ? decodeSegments(parts.slice(2).join('/')) : '';
}

/**
 * Map a full decoded destination path (incl. `/owner/volume` prefix) back to
 * a volume-relative path. Returns `null` for cross-volume destinations.
 * Base matching is case-insensitive (why: volume keys are lowercased at the
 * front door, but `Destination` headers may preserve original casing).
 */
function stripBase(full: string, base: string): string | null {
  const baseTrim = stripSlashes(base);
  const fullLower = full.toLowerCase();
  const baseLower = baseTrim.toLowerCase();
  if (fullLower === baseLower) return '';
  if (baseTrim !== '' && fullLower.startsWith(`${baseLower}/`)) return full.slice(baseTrim.length + 1);
  if (!full.includes('/')) return full;
  const parts = full.split('/');
  return parts.length >= 2 && `${parts[0]}/${parts[1]}`.toLowerCase() === baseTrim.toLowerCase() ? parts.slice(2).join('/') : null;
}

export { fsPathOf, hrefOf, isValidInnerPath, resolveInnerPath, stripBase };
