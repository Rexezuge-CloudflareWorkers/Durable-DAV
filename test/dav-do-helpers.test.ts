import { describe, expect, it } from 'vitest';
import { isValidInnerPath, resolveInnerPath, stripBase } from '../apps/background/src/dav/DavContext';
import { parseRangeHeader } from '../apps/background/src/dav/RangeParser';

describe('DavContext path helpers', () => {
  it('prefers X-Dav-Path header over URL parsing', () => {
    const req = new Request('https://example.com/alice/photos/a/b', { headers: { 'X-Dav-Path': 'a/b' } });
    expect(resolveInnerPath(req, new URL(req.url), '/alice/photos')).toBe('a/b');
  });

  it('strips the /owner/volume base from direct DO URLs', () => {
    const req = new Request('https://example.com/alice/photos/a/b');
    expect(resolveInnerPath(req, new URL(req.url), '/alice/photos')).toBe('a/b');
  });

  it('rejects traversal segments', () => {
    expect(isValidInnerPath('')).toBe(true);
    expect(isValidInnerPath('a/b')).toBe(true);
    expect(isValidInnerPath('a/../b')).toBe(false);
    expect(isValidInnerPath('..')).toBe(false);
    expect(isValidInnerPath('a//b')).toBe(false);
  });

  it('maps Destination full paths back to volume-relative paths', () => {
    expect(stripBase('alice/photos/a/b', '/alice/photos')).toBe('a/b');
    expect(stripBase('alice/photos', '/alice/photos')).toBe('');
    expect(stripBase('bob/other/a', '/alice/photos')).toBeNull();
  });
});

describe('parseRangeHeader', () => {
  it('returns full body when no Range header', () => {
    expect(parseRangeHeader(null, 100)).toMatchObject({ offset: 0, length: undefined, status: 200 });
  });

  it('parses start-end ranges', () => {
    expect(parseRangeHeader('bytes=10-19', 100)).toMatchObject({ offset: 10, length: 10, status: 206 });
  });

  it('parses open-ended and suffix ranges', () => {
    expect(parseRangeHeader('bytes=90-', 100)).toMatchObject({ offset: 90, length: 10, status: 206 });
    expect(parseRangeHeader('bytes=-10', 100)).toMatchObject({ offset: 90, length: 10, status: 206 });
  });

  it('falls back to 200 on malformed or unsatisfiable ranges', () => {
    expect(parseRangeHeader('bytes=banana', 100).status).toBe(200);
    expect(parseRangeHeader('bytes=200-300', 100).status).toBe(200);
    expect(parseRangeHeader('bytes=-0', 100).status).toBe(200);
  });
});
