import { DAV_NAMESPACE, type DeadProperty, renderDavProperty, renderEmptyPropertyElement, renderPropertyElement, renderPropstat } from './xml';
import { escapeXml, getResourceHref } from './path';
import { getLockDiscovery, getSupportedLock, type LockDetails } from './locks';

type DavLiveProperties = {
  creationdate: string | undefined;
  displayname: string | undefined;
  getcontentlanguage: string | undefined;
  getcontentlength: string | undefined;
  getcontenttype: string | undefined;
  getetag: string | undefined;
  getlastmodified: string | undefined;
  resourcetype: string;
  supportedlock: string;
  lockdiscovery: string;
};

type DavNodeInfo = {
  key: string;
  isCollection: boolean;
  size: number;
  etag: string | undefined;
  mtime: Date;
  crtime: Date;
  contentType: string | undefined;
  contentLanguage: string | undefined;
  displayname: string | undefined;
  locks: LockDetails[];
  deadProperties: DeadProperty[];
};

const DEAD_PROPERTY_PREFIX = 'dead_property:';
const LOCK_PROTECTED_NAMES = new Set(['lock_token', 'lock_owner', 'lock_scope', 'lock_depth', 'lock_timeout', 'lock_expires_at', 'lock_root', 'lock_records', 'supportedlock', 'lockdiscovery']);

function getDeadPropertyKey(namespaceURI: string, localName: string): string {
  return `${DEAD_PROPERTY_PREFIX}${encodeURIComponent(namespaceURI)}:${encodeURIComponent(localName)}`;
}

function isProtectedProperty(propName: string | DeadProperty): boolean {
  const local = typeof propName === 'string' ? (propName.split(':').pop() ?? propName) : propName.localName;
  return (
    LOCK_PROTECTED_NAMES.has(local) ||
    (typeof propName !== 'string' &&
      propName.namespaceURI === DAV_NAMESPACE &&
      ['supportedlock', 'lockdiscovery', 'resourcetype'].includes(local))
  );
}

function toLiveProperties(node: DavNodeInfo | null, base = ''): DavLiveProperties {
  if (node === null) {
    return {
      creationdate: new Date().toUTCString(),
      displayname: undefined,
      getcontentlanguage: undefined,
      getcontentlength: '0',
      getcontenttype: undefined,
      getetag: undefined,
      getlastmodified: new Date().toUTCString(),
      resourcetype: '<collection />',
      supportedlock: getSupportedLock(),
      lockdiscovery: '',
    };
  }
  return {
    creationdate: node.crtime.toUTCString(),
    displayname: node.displayname,
    getcontentlanguage: node.contentLanguage,
    getcontentlength: node.isCollection ? undefined : String(node.size),
    getcontenttype: node.isCollection ? undefined : node.contentType,
    getetag: node.isCollection ? undefined : node.etag,
    getlastmodified: node.mtime.toUTCString(),
    resourcetype: node.isCollection ? '<collection />' : '',
    supportedlock: getSupportedLock(),
    lockdiscovery:
      node.locks.length === 0
        ? ''
        : getLockDiscovery(
            node.locks.map((l) => ({ ...l, root: getResourceHref(node.key, node.isCollection, base) })),
          ),
  };
}

function getLivePropertyValue(node: DavNodeInfo | null, property: DeadProperty): string | undefined {
  if (property.namespaceURI !== DAV_NAMESPACE) return undefined;
  // Why `Object.hasOwn` and not a plain index: `property.localName` is
  // client-controlled, so a plain lookup walks the prototype chain and hands
  // back `constructor`/`__proto__`/`toString` — `escapeXml` then calls
  // `.replaceAll` on a function and throws, turning any PROPFIND into a 500.
  // The own-property check also removes the need for a `keyof` assertion.
  const live: Record<string, string | undefined> = toLiveProperties(node);
  return Object.hasOwn(live, property.localName) ? live[property.localName] : undefined;
}

function generatePropfindResponse(
  node: DavNodeInfo | null,
  mode: 'allprop' | 'propname' | 'prop',
  requested: DeadProperty[] = [],
  base = '',
): string {
  const href = getResourceHref(node?.key ?? '', node?.isCollection ?? true, base);
  const live = toLiveProperties(node, base);
  const liveEntries = Object.entries(live).flatMap(([key, value]) =>
    value === undefined ? [] : [renderDavProperty(key, value)],
  );
  const dead = node?.deadProperties ?? [];

  let ok: string[] = [];
  const missing: string[] = [];

  if (mode === 'allprop') {
    ok = [...liveEntries, ...dead.map(renderPropertyElement)];
  } else if (mode === 'propname') {
    ok = [
      ...Object.entries(live).flatMap(([key, value]) => (value === undefined ? [] : [renderDavProperty(key, '')])),
      ...dead.map((p) => renderEmptyPropertyElement({ ...p, valueXml: '' })),
    ];
  } else {
    for (const property of requested) {
      const liveValue = getLivePropertyValue(node, property);
      if (liveValue !== undefined) {
        ok.push(renderDavProperty(property.localName, liveValue));
        continue;
      }
      const found = dead.find((d) => d.namespaceURI === property.namespaceURI && d.localName === property.localName);
      if (found) ok.push(renderPropertyElement(found));
      else missing.push(renderEmptyPropertyElement({ ...property, valueXml: '' }));
    }
  }

  return `\n<response>\n<href>${escapeXml(href)}</href>${renderPropstat('HTTP/1.1 200 OK', ok)}${renderPropstat('HTTP/1.1 404 Not Found', missing)}\n</response>`;
}

export { getDeadPropertyKey, isProtectedProperty, toLiveProperties, getLivePropertyValue, generatePropfindResponse };
export type { DavLiveProperties, DavNodeInfo };
