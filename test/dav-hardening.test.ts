import { describe, expect, it } from 'vitest';
import { parseRangeHeader } from '../apps/background/src/dav/RangeParser';
import { isValidInnerPath, resolveInnerPath, stripBase } from '../apps/background/src/dav/DavContext';

describe('RangeParser hardening', () => {
  it('clamps ranges ending past the representation size', () => {
    const r = parseRangeHeader('bytes=0-9999', 10);
    expect(r).toMatchObject({ offset: 0, length: 10, status: 206, contentRange: 'bytes 0-9/10' });
  });

  it('falls back to 200 for empty files', () => {
    expect(parseRangeHeader('bytes=0-', 0).status).toBe(200);
    expect(parseRangeHeader('bytes=-10', 0).status).toBe(200);
    expect(parseRangeHeader('bytes=0-5', 0)).toMatchObject({ status: 200, length: undefined });
  });

  it('handles suffix larger than size and exact-boundary offsets', () => {
    expect(parseRangeHeader('bytes=-100', 10)).toMatchObject({ offset: 0, length: 10, status: 206 });
    expect(parseRangeHeader('bytes=9-9', 10)).toMatchObject({ offset: 9, length: 1, status: 206 });
    expect(parseRangeHeader('bytes=10-', 10).status).toBe(200);
  });
});

describe('DavContext hardening', () => {
  it('decodes percent-encoded traversal in X-Dav-Path so validation rejects it', () => {
    const req = new Request('https://example.com/a/b', { headers: { 'X-Dav-Path': 'a/%2e%2e/b' } });
    const inner = resolveInnerPath(req, new URL(req.url), '/a/b');
    expect(inner).toBe('a/../b');
    expect(isValidInnerPath(inner)).toBe(false);
  });

  it('matches Destination base case-insensitively', () => {
    expect(stripBase('ALICE/Photos/a', '/alice/photos')).toBe('a');
    expect(stripBase('alice/photos', '/ALICE/PHOTOS')).toBe('');
  });
});
