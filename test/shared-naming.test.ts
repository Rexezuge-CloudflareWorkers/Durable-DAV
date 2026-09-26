import { describe, expect, it } from 'vitest';
import { isValidUsername, isValidVolumeName, USERNAME_MAX_LENGTH } from '@durable-dav/shared/constants';
import { isValidEmailFormat } from '@durable-dav/shared/utils';
import { parsePropfindRequest, parseProppatchRequest } from '@durable-dav/webdav';

describe('shared naming rules are single-sourced', () => {
  it('accepts ordinary handles', () => {
    for (const name of ['a', 'alice', 'a1', 'a-b', 'a-b-c', 'user123', '0abc']) {
      expect(isValidUsername(name), name).toBe(true);
    }
  });

  it('rejects handles no username could ever have', () => {
    // The old owner regex allowed a trailing hyphen, so a bucket could be
    // created under an owner that `/users/:username` could never resolve.
    for (const name of ['-alice', 'alice-', 'a b', 'a_b', 'a.b', '', 'ünicode']) {
      expect(isValidUsername(name), name).toBe(false);
    }
  });

  it('tolerates an interior double hyphen, as the original rule did', () => {
    // `deriveUsernameCandidate` collapses `-{2,}` when deriving a candidate
    // from an email, but the stored rule has always permitted them. Tightening
    // this would invalidate existing usernames, so the behaviour is preserved
    // and pinned by a test rather than silently changed.
    expect(isValidUsername('a--b')).toBe(true);
  });

  it('enforces the 39-character bound', () => {
    expect(isValidUsername('a'.repeat(USERNAME_MAX_LENGTH))).toBe(true);
    expect(isValidUsername('a'.repeat(USERNAME_MAX_LENGTH + 1))).toBe(false);
  });

  it('allows dots and underscores in bucket names but not in usernames', () => {
    expect(isValidVolumeName('my.bucket_1')).toBe(true);
    expect(isValidUsername('my.bucket_1')).toBe(false);
    expect(isValidVolumeName('-leading')).toBe(false);
    expect(isValidVolumeName('a'.repeat(101))).toBe(false);
  });
});

describe('email shape validation', () => {
  it('accepts plausible addresses', () => {
    for (const value of ['a@b.co', 'first.last@sub.example.com', 'x+tag@example.org']) {
      expect(isValidEmailFormat(value), value).toBe(true);
    }
  });

  it('rejects malformed addresses', () => {
    for (const value of ['', 'nope', 'a@', '@b.co', 'a b@c.co', 'a@b', `a@${'b'.repeat(250)}.co`]) {
      expect(isValidEmailFormat(value), value).toBe(false);
    }
  });
});

describe('XML element names from client documents are validated', () => {
  const propfind = (prop: string): string => `<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:z="urn:z"><prop>${prop}</prop></propfind>`;

  it('accepts a well-formed qualified name', () => {
    const parsed = parsePropfindRequest(propfind('<z:custom xmlns:z="urn:z"/>'));
    expect(parsed?.mode).toBe('prop');
    expect(parsed?.mode === 'prop' ? parsed.properties[0]?.localName : undefined).toBe('custom');
  });

  it('rejects a local name that is not a valid NCName', () => {
    // Names are interpolated straight into element names by
    // `renderPropertyElement`; an unvalidated one can emit malformed XML that
    // is stored verbatim in `dav_props`.
    expect(parsePropfindRequest(propfind('<1bad xmlns="urn:z"/>'))).toBeNull();
  });

  it('rejects a prefix containing a colon or invalid character', () => {
    expect(parseProppatchRequest(propfind('<a:b:c xmlns:a="urn:a"/>'))).toBeNull();
  });

  it('still rejects a prefixed name with no namespace declaration', () => {
    expect(parsePropfindRequest('<?xml version="1.0"?><propfind xmlns="DAV:"><prop><z:custom/></prop></propfind>')).toBeNull();
  });
});
