import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  getResourceHref,
  decodeResourcePath,
  getParentPath,
  parseDestinationPath,
  isSameOrDescendantPath,
  normalizeVolumeKey,
  splitVolumePath,
  parsePropfindRequest,
  parseProppatchRequest,
  parseTimeout,
  normalizeLockToken,
  determineLockDepth,
  DAV_CLASS,
  SUPPORT_METHODS,
  getDeadPropertyKey,
  isProtectedProperty,
  generatePropfindResponse,
} from '@durable-dav/webdav';
import { coversScope as coversTokenScope } from '@durable-dav/backend-services/auth';

describe('DuraDAV path helpers (RFC 4918)', () => {
  it('escapes XML', () => {
    expect(escapeXml('<a>&"\'')).toBe('&lt;a&gt;&amp;&quot;&apos;');
  });

  it('builds hrefs with collection slash', () => {
    expect(getResourceHref('', true)).toBe('/');
    expect(getResourceHref('a/b', true)).toBe('/a/b/');
    expect(getResourceHref('a/b c', false)).toBe('/a/b%20c');
  });

  it('round-trips decode', () => {
    expect(decodeResourcePath('/')).toBe('');
    expect(decodeResourcePath('/a/b%20c/')).toBe('a/b c');
  });

  it('computes parent', () => {
    expect(getParentPath('a/b/c')).toBe('a/b');
    expect(getParentPath('a')).toBe('');
  });

  it('rejects cross-origin Destination', () => {
    expect(parseDestinationPath('https://other.test/a', 'https://example.test/b')).toBeNull();
    expect(parseDestinationPath('/alice/vol/file', 'https://example.test/alice/vol/')).toBe('alice/vol/file');
  });

  it('detects self/descendant for COPY/MOVE 403-equivalent guard', () => {
    expect(isSameOrDescendantPath('a', 'a')).toBe(true);
    expect(isSameOrDescendantPath('a', 'a/b')).toBe(true);
    expect(isSameOrDescendantPath('a/b', 'a')).toBe(false);
    expect(isSameOrDescendantPath('', 'a')).toBe(true);
  });

  it('normalizes volume keys case-insensitively (one DO per volume)', () => {
    expect(normalizeVolumeKey('Alice', 'Photos')).toBe('alice/photos');
  });

  it('splits /owner/volume/inner paths (multi-volume routing)', () => {
    expect(splitVolumePath('/')).toBeNull();
    expect(splitVolumePath('/alice')).toBeNull();
    expect(splitVolumePath('/alice/photos/a/b')).toEqual({ owner: 'alice', volume: 'photos', innerPath: 'a/b' });
  });
});

describe('DuraDAV XML (PROPFIND/PROPPATCH)', () => {
  it('defaults empty PROPFIND body to allprop', () => {
    expect(parsePropfindRequest('')).toEqual({ mode: 'allprop' });
    expect(parsePropfindRequest('<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>')).toEqual({ mode: 'allprop' });
  });

  it('parses propname and prop modes', () => {
    expect(parsePropfindRequest('<propfind xmlns="DAV:"><propname/></propfind>')).toEqual({ mode: 'propname' });
    const prop = parsePropfindRequest('<propfind xmlns="DAV:"><prop><getcontentlength xmlns="DAV:"/></prop></propfind>');
    expect(prop?.mode).toBe('prop');
  });

  it('rejects malformed XML', () => {
    expect(parsePropfindRequest('<propfind><unclosed>')).toBeNull();
    expect(parsePropfindRequest('<wrong xmlns="DAV:"><allprop/></wrong>')).toBeNull();
  });

  it('parses PROPPATCH set/remove', () => {
    const parsed = parseProppatchRequest(
      '<propertyupdate xmlns="DAV:"><set><prop><foo xmlns="urn:x">bar</foo></prop></set><remove><prop><baz xmlns="urn:x"/></prop></remove></propertyupdate>',
    );
    expect(parsed?.operations).toHaveLength(2);
    expect(parsed?.operations[0].action).toBe('set');
    expect(parsed?.operations[1].action).toBe('remove');
  });

  it('protects live lock properties from PROPPATCH', () => {
    expect(isProtectedProperty('supportedlock')).toBe(true);
    expect(isProtectedProperty('lockdiscovery')).toBe(true);
    expect(isProtectedProperty({ namespaceURI: 'DAV:', localName: 'getcontentlength', prefix: null, valueXml: '' })).toBe(false);
    expect(getDeadPropertyKey('urn:x', 'foo')).toContain('dead_property:');
  });

  it('renders multistatus responses', () => {
    const xml = generatePropfindResponse(null, 'allprop');
    expect(xml).toContain('<response>');
    expect(xml).toContain('<href>/</href>');
  });
});

describe('DuraDAV locks (Class 2)', () => {
  it('normalizes lock tokens', () => {
    expect(normalizeLockToken('<urn:uuid:abc>')).toBe('abc');
    expect(normalizeLockToken('<opaquelocktoken:abc>')).toBe('abc');
  });

  it('determines depth (collections default infinity)', () => {
    expect(determineLockDepth(true, null)).toBe('infinity');
    expect(determineLockDepth(false, null)).toBe('0');
    expect(determineLockDepth(false, 'infinity')).toBe('infinity');
  });

  it('parses Timeout headers', () => {
    expect(parseTimeout(null).timeout).toContain('Second-');
    expect(parseTimeout('Infinite').timeout).toBe('Infinite');
    expect(parseTimeout('Second-60').timeout).toBe('Second-60');
    expect(parseTimeout('garbage').timeout).toContain('Second-');
  });
});

describe('DuraDAV protocol surface', () => {
  it('advertises Class 1, 2', () => {
    expect(DAV_CLASS).toBe('1, 2');
  });

  it('supports all required methods', () => {
    for (const method of ['OPTIONS', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'GET', 'HEAD', 'PUT', 'DELETE', 'COPY', 'MOVE', 'LOCK', 'UNLOCK']) {
      expect(SUPPORT_METHODS).toContain(method);
    }
  });

  it('PAT scopes cover DAV read/write (dav:* primary, repo:* legacy)', () => {
    expect(coversTokenScope(['dav:write'], 'dav:read')).toBe(true);
    expect(coversTokenScope(['dav:read'], 'dav:write')).toBe(false);
    expect(coversTokenScope(['admin'], 'dav:write')).toBe(true);
    expect(coversTokenScope(['repo:write'], 'dav:read')).toBe(true);
    expect(coversTokenScope(['dav:write'], 'repo:read')).toBe(true);
  });
});
