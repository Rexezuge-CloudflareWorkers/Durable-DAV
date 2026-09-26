import { describe, expect, it } from 'vitest';
import {
  generatePropfindResponse,
  getIfHeaderEtags,
  getRequestLockTokens,
  hasAlwaysFalseIfCondition,
  isSameOrDescendantPath,
  parseIfHeader,
  getResourceHref,
} from '@durable-dav/webdav';
import { DavConditionalGuard } from '../apps/background/src/dav/DavConditionalGuard';
import { isValidInnerPath } from '../apps/background/src/dav/DavContext';
import { parseMultistatus } from '../apps/web/src/lib/davXml';

describe('DAV:href carries the volume base (RFC 4918 §8.3)', () => {
  // Regression: hrefs were volume-relative (`/dir/f.txt`) while the request URL
  // was `https://host/alice/photos/dir/`. Third-party clients resolve hrefs
  // against the request URL, so every entry 404'd outside the volume. The SPA
  // had grown a `stripSlashes` compensation that masked it for first-party use.
  it('prefixes a file href with the volume base', () => {
    expect(getResourceHref('dir/hello.txt', false, '/alice/photos')).toBe('/alice/photos/dir/hello.txt');
  });

  it('appends a trailing slash for collections', () => {
    expect(getResourceHref('dir', true, '/alice/photos')).toBe('/alice/photos/dir/');
    expect(getResourceHref('', true, '/alice/photos')).toBe('/alice/photos/');
  });

  it('percent-encodes each segment but not the base', () => {
    expect(getResourceHref('a b/c d.txt', false, '/alice/photos')).toBe('/alice/photos/a%20b/c%20d.txt');
  });

  it('still supports the bare base-less form', () => {
    expect(getResourceHref('a/b', true)).toBe('/a/b/');
    expect(getResourceHref('', true)).toBe('/');
  });

  it('emits the prefixed href inside a PROPFIND multistatus', () => {
    const node = {
      key: 'dir/hello.txt',
      isCollection: false,
      size: 5,
      etag: '"abc"',
      mtime: new Date(0),
      crtime: new Date(0),
      contentType: 'text/plain',
      contentLanguage: undefined,
      displayname: undefined,
      locks: [],
      deadProperties: [],
    };
    const xml = generatePropfindResponse(node, 'allprop', [], '/alice/photos');
    expect(xml).toContain('<href>/alice/photos/dir/hello.txt</href>');
    expect(xml).not.toContain('<href>/dir/hello.txt</href>');
  });
});

describe('SPA href parsing handles prefixed and legacy hrefs', () => {
  const block = (href: string, extra = ''): string =>
    `<response><href>${href}</href>${extra}<propstat><prop><getcontentlength>5</getcontentlength></prop><status>HTTP/1.1 200 OK</status></propstat></response>`;

  it('strips the volume base to recover volume-relative paths', () => {
    const xml =
      `<multistatus xmlns="DAV:">${block('/alice/photos/')}` +
      `${block('/alice/photos/dir/', '<propstat><prop><resourcetype><collection /></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat>')}` +
      `${block('/alice/photos/dir/f.txt')}</multistatus>`;
    const entries = parseMultistatus(xml, '', '/alice/photos');
    expect(entries.map((e) => e.path)).toEqual(['dir', 'dir/f.txt']);
    expect(entries.find((e) => e.name === 'dir')?.isCollection).toBe(true);
    expect(entries.find((e) => e.name === 'f.txt')?.isCollection).toBe(false);
  });

  it('still accepts unprefixed hrefs from a non-conforming server', () => {
    const xml = `<multistatus xmlns="DAV:">${block('/')}${block('/dir/f.txt')}</multistatus>`;
    const entries = parseMultistatus(xml, '', '/alice/photos');
    expect(entries.map((e) => e.path)).toEqual(['dir/f.txt']);
  });

  it('drops the self-response when listing a subdirectory', () => {
    const xml = `<multistatus xmlns="DAV:">${block('/alice/photos/dir/')}${block('/alice/photos/dir/child.txt')}</multistatus>`;
    const entries = parseMultistatus(xml, 'dir', '/alice/photos');
    expect(entries.map((e) => e.path)).toEqual(['dir/child.txt']);
  });
});

describe('If header grammar (RFC 4918 §10.4)', () => {
  it('extracts state tokens', () => {
    const req = new Request('https://x/', { headers: { If: '(<urn:uuid:abc>)' } });
    expect(getRequestLockTokens(req)).toEqual(['abc']);
  });

  it('honours Lock-Token alongside If', () => {
    const req = new Request('https://x/', { headers: { 'Lock-Token': '<opaquelocktoken:zzz>', If: '(<urn:uuid:abc>)' } });
    expect(getRequestLockTokens(req).sort()).toEqual(['abc', 'zzz']);
  });

  it('does not mistake an entity-tag condition for a lock token', () => {
    // The old regex read `(<"etag">)` as a token literally named `<"etag">`,
    // so the conditional-PUT mechanism desktop clients use never matched.
    const req = new Request('https://x/', { headers: { If: '(["weak-etag"])' } });
    expect(getRequestLockTokens(req)).toEqual([]);
    expect(getIfHeaderEtags(req)).toEqual([{ etag: '"weak-etag"', negated: false }]);
  });

  it('parses Not conditions', () => {
    expect(parseIfHeader('(Not <urn:uuid:abc>)')).toEqual([{ kind: 'token', value: 'urn:uuid:abc', negated: true }]);
  });

  it('accepts a no-lock condition, which is only false when the resource is locked', () => {
    // §10.4.4: `<DAV:no-lock>` "evaluates to false if the resource is locked,
    // and true if it is not". The old implementation 412'd the plain form —
    // breaking a valid unlocked request — while accepting the negated form on a
    // locked resource, which is the inverse of the spec. Lock state is
    // DavLockGuard's job, so neither is a static always-false.
    expect(hasAlwaysFalseIfCondition(new Request('https://x/', { headers: { If: '(<DAV:no-lock>)' } }))).toBe(false);
    expect(hasAlwaysFalseIfCondition(new Request('https://x/', { headers: { If: '(Not <DAV:no-lock>)' } }))).toBe(false);
  });

  it('recognises the no-lock token case-insensitively without failing the header', () => {
    const conditions = parseIfHeader('(<dav:no-lock>)');
    expect(conditions).toEqual([{ kind: 'no-lock', negated: false }]);
  });

  it('does not flag an ordinary token If header', () => {
    expect(hasAlwaysFalseIfCondition(new Request('https://x/', { headers: { If: '(<urn:uuid:abc>)' } }))).toBe(false);
    expect(hasAlwaysFalseIfCondition(new Request('https://x/'))).toBe(false);
  });

  it('fails closed on an unparseable If header', () => {
    expect(hasAlwaysFalseIfCondition(new Request('https://x/', { headers: { If: '(garbage' } }))).toBe(true);
  });

  it('reads one condition per list, ignoring text between lists', () => {
    // A `Resource-Tag` is a bare `<…>` that is not itself a list, and a list
    // holds several conditions; only the parenthesised ones count.
    expect(parseIfHeader('<http://x/r> (<urn:uuid:abc>)')).toEqual([{ kind: 'token', value: 'urn:uuid:abc', negated: false }]);
    expect(parseIfHeader('(<urn:uuid:abc>) (["e1"])')).toEqual([
      { kind: 'token', value: 'urn:uuid:abc', negated: false },
      { kind: 'etag', value: '"e1"', negated: false },
    ]);
    expect(parseIfHeader('(<urn:uuid:a>) junk (<urn:uuid:b>)')).toEqual([
      { kind: 'token', value: 'urn:uuid:a', negated: false },
      { kind: 'token', value: 'urn:uuid:b', negated: false },
    ]);
  });

  it('fails closed when a group opens but never closes', () => {
    // The scan cannot advance past a `]` that does not exist, so it stops and
    // reports the header as unreadable rather than guessing at the remainder.
    expect(parseIfHeader('([unterminated')).toEqual([{ kind: 'unknown' }]);
    expect(parseIfHeader('(<unterminated')).toEqual([{ kind: 'unknown' }]);
    expect(hasAlwaysFalseIfCondition(new Request('https://x/', { headers: { If: '(<urn:uuid:a>) ([bad' } }))).toBe(true);
  });

  it('reports an empty group as unreadable instead of ignoring it', () => {
    expect(parseIfHeader('()')).toEqual([{ kind: 'unknown' }]);
    expect(hasAlwaysFalseIfCondition(new Request('https://x/', { headers: { If: '()' } }))).toBe(true);
  });

  it('parses a large adversarial If header in linear time (CodeQL js/polynomial-redos)', () => {
    // The old `/\(\s*(Not\s+)?(<[^>]*>|\[[^\]]*\])/gi` matched at every `(` and
    // re-ran the `\[[^\]]*\]` backtrack over the rest of the header each time:
    // 3.6 s at the 64 KB platform header limit, from a single request.
    const hostile = '[('.repeat(32_768);
    const startedAt = performance.now();
    parseIfHeader(hostile);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});

describe('DavConditionalGuard (RFC 7232)', () => {
  const guard = new DavConditionalGuard();
  const state = { etag: '"v1"', mtime: Date.UTC(2024, 0, 1) };
  const req = (headers: Record<string, string>): Request => new Request('https://x/', { headers });

  it('passes when no preconditions are sent', () => {
    expect(guard.check(req({}), state)).toBeNull();
  });

  it('412s an If-Match that does not match', () => {
    expect(guard.check(req({ 'If-Match': '"stale"' }), state)?.status).toBe(412);
  });

  it('passes a matching If-Match', () => {
    expect(guard.check(req({ 'If-Match': '"v1"' }), state)).toBeNull();
  });

  it('412s If-Match: * against a resource with no ETag', () => {
    expect(guard.check(req({ 'If-Match': '*' }), { etag: null, mtime: null })?.status).toBe(412);
    expect(guard.check(req({ 'If-Match': '*' }), state)).toBeNull();
  });

  it('412s a create-only If-None-Match: * on write', () => {
    expect(guard.check(req({ 'If-None-Match': '*' }), state)?.status).toBe(412);
  });

  it('answers 304 for If-None-Match on read', () => {
    const res = guard.check(req({ 'If-None-Match': '"v1"' }), state, { forRead: true });
    expect(res?.status).toBe(304);
    expect(res?.headers.get('ETag')).toBe('"v1"');
  });

  it('tolerates weak validators on either side', () => {
    expect(guard.check(req({ 'If-Match': 'W/"v1"' }), state)).toBeNull();
  });

  it('412s an If-Unmodified-Since older than the resource', () => {
    const old = new Date(Date.UTC(2023, 0, 1)).toUTCString();
    expect(guard.check(req({ 'If-Unmodified-Since': old }), state)?.status).toBe(412);
    const future = new Date(Date.UTC(2025, 0, 1)).toUTCString();
    expect(guard.check(req({ 'If-Unmodified-Since': future }), state)).toBeNull();
  });

  it('evaluates entity-tag conditions from the If header', () => {
    expect(guard.check(req({ If: '(["v1"])' }), state)).toBeNull();
    expect(guard.check(req({ If: '(["other"])' }), state)?.status).toBe(412);
    // §10.4: `Not` binds to a single condition inside a list.
    expect(guard.check(req({ If: '(Not ["other"])' }), state)).toBeNull();
    expect(guard.check(req({ If: '(Not ["v1"])' }), state)?.status).toBe(412);
  });

  it('answers 304 for If-Modified-Since on read', () => {
    const since = new Date(Date.UTC(2024, 0, 2)).toUTCString();
    expect(guard.check(req({ 'If-Modified-Since': since }), state, { forRead: true })?.status).toBe(304);
  });
});

describe('COPY/MOVE destination rules', () => {
  it('treats the volume root as the container of everything (helper contract)', () => {
    // `isSameOrDescendantPath` answers "is dest inside src?". Callers must
    // therefore compare equality separately — which is how the volume root
    // became un-copyable, since the root contains every non-empty path.
    expect(isSameOrDescendantPath('', 'a')).toBe(true);
    expect(isSameOrDescendantPath('a', 'a')).toBe(true);
    expect(isSameOrDescendantPath('a', 'ab')).toBe(false);
  });

  it('rejects encoded traversal in a destination', () => {
    expect(isValidInnerPath('../../etc')).toBe(false);
    expect(isValidInnerPath('a/../b')).toBe(false);
    expect(isValidInnerPath('a//b')).toBe(false);
    expect(isValidInnerPath('a/b')).toBe(true);
  });
});
