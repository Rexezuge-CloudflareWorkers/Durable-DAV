function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function encodeHrefPath(href: string): string {
  return href === '/' ? '/' : href
    .split('/')
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
    .join('/');
}

/**
 * Build the `DAV:href` for a volume-relative resource key.
 *
 * `base` is the volume's public prefix (`/owner/volume`) as supplied by the
 * front door. RFC 4918 §8.3 requires every `DAV:href` to be a URI reference
 * that resolves against the *request* URL, so it must include that prefix.
 * Omitting it produces `/dir/file.txt` for a request to
 * `https://host/alice/photos/dir/`; third-party clients (Finder, Explorer,
 * Cyberduck, rclone) resolve that against the request URL and land outside the
 * volume, i.e. 404 for every entry.
 */
function getResourceHref(key: string, isCollection: boolean, base = ''): string {
  const prefix = stripSlashes(base);
  if (key === '') return prefix === '' ? '/' : `/${prefix}/`;
  const suffix = key + (isCollection ? '/' : '');
  return encodeHrefPath(prefix === '' ? `/${suffix}` : `/${prefix}/${suffix}`);
}

function decodeResourcePath(pathname: string): string {
  let resourcePath = pathname.slice(1);
  resourcePath = resourcePath.endsWith('/') ? resourcePath.slice(0, -1) : resourcePath;
  if (resourcePath === '') return '';
  return resourcePath
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

function getParentPath(resourcePath: string): string {
  const normalizedPath = resourcePath.endsWith('/') ? resourcePath.slice(0, -1) : resourcePath;
  return normalizedPath.split('/').slice(0, -1).join('/');
}

function parseDestinationPath(destinationHeader: string, requestUrl: string): string | null {
  try {
    const destinationUrl = new URL(destinationHeader, requestUrl);
    return destinationUrl.origin === new URL(requestUrl).origin ? decodeResourcePath(destinationUrl.pathname) : null;
  } catch {
    return null;
  }
}

function isSameOrDescendantPath(resourcePath: string, destinationPath: string): boolean {
  if (destinationPath === resourcePath) return true;
  return resourcePath === '' ? destinationPath !== '' : destinationPath.startsWith(`${resourcePath}/`);
}

function normalizeVolumeKey(owner: string, name: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}`;
}

function stripSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start += 1;
  while (end > start && value[end - 1] === '/') end -= 1;
  return value.slice(start, end);
}

function splitVolumePath(pathname: string): { owner: string; volume: string; innerPath: string } | null {
  const trimmed = stripSlashes(pathname);
  if (trimmed === '') return null;
  const parts = trimmed.split('/').map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (parts.length < 2) return null;
  const [owner, volume, ...rest] = parts;
  return !owner || !volume ? null : { owner, volume, innerPath: rest.join('/') };
}

export {
  escapeXml,
  getResourceHref,
  decodeResourcePath,
  getParentPath,
  parseDestinationPath,
  isSameOrDescendantPath,
  normalizeVolumeKey,
  stripSlashes,
  splitVolumePath,
};
