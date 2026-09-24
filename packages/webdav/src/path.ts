function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function encodeHrefPath(href: string): string {
  if (href === '/') return '/';
  return href
    .split('/')
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
    .join('/');
}

function getResourceHref(key: string, isCollection: boolean): string {
  if (key === '') return '/';
  return encodeHrefPath(`/${key + (isCollection ? '/' : '')}`);
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
    if (destinationUrl.origin !== new URL(requestUrl).origin) return null;
    return decodeResourcePath(destinationUrl.pathname);
  } catch {
    return null;
  }
}

function isSameOrDescendantPath(resourcePath: string, destinationPath: string): boolean {
  if (destinationPath === resourcePath) return true;
  if (resourcePath === '') return destinationPath !== '';
  return destinationPath.startsWith(`${resourcePath}/`);
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
  if (!owner || !volume) return null;
  return { owner, volume, innerPath: rest.join('/') };
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
