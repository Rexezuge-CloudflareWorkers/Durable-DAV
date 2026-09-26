import { describe, expect, it } from 'vitest';
import { DavCredentialUtil } from '@durable-dav/shared/utils';
import { CryptoUtil } from '@durable-dav/shared/utils';

/**
 * Password storage for WebDAV Basic credentials.
 *
 * These passwords authenticate the entire WebDAV surface, so the storage format
 * is a security boundary, not an implementation detail.
 */
describe('DavCredentialUtil password hashing', () => {
  it('produces a self-describing pbkdf2-sha256 encoding', async () => {
    const stored = await DavCredentialUtil.hashPassword('correct horse battery staple');
    const parts = stored.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2-sha256');
    expect(Number(parts[1])).toBeGreaterThanOrEqual(100_000);
    expect(parts[2]).not.toBe('');
    expect(parts[3]).not.toBe('');
  });

  it('salts every hash, so identical passwords do not collide', async () => {
    // With a bare unsalted digest every user who picked the same password
    // shares a hash, so one rainbow-table lookup cracks all of them.
    const [a, b] = await Promise.all([DavCredentialUtil.hashPassword('hunter2'), DavCredentialUtil.hashPassword('hunter2')]);
    expect(a).not.toBe(b);
  });

  it('is not the legacy sha256 digest', async () => {
    const password = 'plaintext';
    const stored = await DavCredentialUtil.hashPassword(password);
    expect(stored).not.toBe(await CryptoUtil.sha256Hex(password));
  });

  it('verifies the correct password', async () => {
    const stored = await DavCredentialUtil.hashPassword('s3cret');
    await expect(DavCredentialUtil.verifyPassword('s3cret', stored)).resolves.toEqual({ ok: true, needsRehash: false });
  });

  it('rejects the wrong password', async () => {
    const stored = await DavCredentialUtil.hashPassword('s3cret');
    await expect(DavCredentialUtil.verifyPassword('s3cre', stored)).resolves.toEqual({ ok: false, needsRehash: false });
    await expect(DavCredentialUtil.verifyPassword('s3crets', stored)).resolves.toEqual({ ok: false, needsRehash: false });
    await expect(DavCredentialUtil.verifyPassword('', stored)).resolves.toEqual({ ok: false, needsRehash: false });
  });

  it('is case- and unicode-exact', async () => {
    const stored = await DavCredentialUtil.hashPassword('Passwörd🔒');
    await expect(DavCredentialUtil.verifyPassword('Passwörd🔒', stored)).resolves.toMatchObject({ ok: true });
    await expect(DavCredentialUtil.verifyPassword('passwörd🔒', stored)).resolves.toMatchObject({ ok: false });
  });

  it('handles a very long password', async () => {
    const password = 'x'.repeat(4096);
    const stored = await DavCredentialUtil.hashPassword(password);
    await expect(DavCredentialUtil.verifyPassword(password, stored)).resolves.toMatchObject({ ok: true });
  });
});

describe('DavCredentialUtil legacy hash migration', () => {
  it('accepts a legacy unsalted digest and flags it for rehash', async () => {
    // This is what every credential created before the migration stores. It
    // must keep working, and the flag is what drives the opportunistic upgrade.
    const stored = await CryptoUtil.sha256Hex('old-password');
    await expect(DavCredentialUtil.verifyPassword('old-password', stored)).resolves.toEqual({ ok: true, needsRehash: true });
  });

  it('does not flag a legacy digest when the password is wrong', async () => {
    // Flagging a non-match would let an attacker trigger hash rewrites by
    // guessing wrong.
    const stored = await CryptoUtil.sha256Hex('old-password');
    await expect(DavCredentialUtil.verifyPassword('wrong', stored)).resolves.toEqual({ ok: false, needsRehash: false });
  });

  it('accepts an uppercase legacy digest', async () => {
    const stored = (await CryptoUtil.sha256Hex('old-password')).toUpperCase();
    await expect(DavCredentialUtil.verifyPassword('old-password', stored)).resolves.toMatchObject({ ok: true });
  });

  it('throws on a hash in neither format', async () => {
    // Not `false`: a malformed hash means the row is unusable, and reporting
    // "wrong password" sends the user into a reset loop that cannot succeed.
    await expect(DavCredentialUtil.verifyPassword('x', '')).rejects.toThrow(/unrecognized/i);
    await expect(DavCredentialUtil.verifyPassword('x', 'not-a-hash')).rejects.toThrow(/unrecognized/i);
    await expect(DavCredentialUtil.verifyPassword('x', 'a'.repeat(63))).rejects.toThrow(/unrecognized/i);
  });
});

describe('DavCredentialUtil malformed pbkdf2 rows', () => {
  it('rejects a truncated encoding without throwing', async () => {
    // Distinct from the "neither format" case: the prefix says pbkdf2, so a
    // corrupt body is a failed verification, not a programming error.
    for (const stored of [
      'pbkdf2-sha256$100000',
      'pbkdf2-sha256$100000$abc',
      'pbkdf2-sha256$100000$abc$def$extra',
      'pbkdf2-sha256$notanumber$abc$def',
      'pbkdf2-sha256$0$abc$def',
      'pbkdf2-sha256$-5$abc$def',
      'pbkdf2-sha256$1e300$abc$def',
    ]) {
      await expect(DavCredentialUtil.verifyPassword('x', stored), stored).resolves.toMatchObject({ ok: false });
    }
  });

  it('rejects a hostile iteration count rather than burning CPU on it', async () => {
    // `1e300` is a safe "integer" but not a safe work factor. Left unchecked it
    // turns one Basic-auth request into a CPU-exhaustion vector.
    await expect(DavCredentialUtil.verifyPassword('x', 'pbkdf2-sha256$1e300$AAAAAAAAAAAAAAAAAAAAAA$AAAA')).resolves.toMatchObject({
      ok: false,
    });
  });

  it('rejects an empty salt', async () => {
    await expect(DavCredentialUtil.verifyPassword('x', 'pbkdf2-sha256$1000$$AAAAAAAAAAAAAAAAAAAAAA')).resolves.toMatchObject({ ok: false });
  });
});

describe('credential display fields', () => {
  it('exposes a prefix and last four without the secret', () => {
    const password = 'ddav_abcdefghijklmnop';
    // The whole password is shown once at creation and never stored; only these
    // two slices are persisted for display, so they must not reconstruct it.
    const prefix = DavCredentialUtil.getPrefix(password);
    const lastFour = DavCredentialUtil.getLastFour(password);
    expect(prefix).toHaveLength(10);
    expect(lastFour).toHaveLength(4);
    expect(prefix + lastFour).not.toBe(password);
  });
});
