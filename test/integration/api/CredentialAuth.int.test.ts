import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { setupIntegrationTest, ensureUser } from '../helpers/setup';
import { DavCredentialUtil } from '@durable-dav/shared/utils';

/**
 * Bucket-credential authentication against real D1.
 *
 * The password-hash format changed from an unsalted SHA-256 to salted PBKDF2,
 * which also changed the *lookup*: a salted hash cannot be searched on, so the
 * auth path loads by username and verifies in the worker. These tests exercise
 * the resulting behaviour end-to-end over the real worker, including the
 * migration path for credentials that predate it.
 */

type TestEnv = Record<string, unknown> & { DB: D1Database };

const OWNER = 'credown';
const VOLUME = 'credown-vol';
const EMAIL = 'test@example.com';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let ownerHandle = OWNER;

async function ensureVolume(): Promise<void> {
  const testEnv = env as unknown as TestEnv;
  await setupIntegrationTest(testEnv, EMAIL);
  await ensureUser(testEnv.DB, EMAIL, OWNER);
  const row = await testEnv.DB.prepare('SELECT username FROM users WHERE email = ?').bind(EMAIL).first<{ username: string | null }>();
  ownerHandle = row?.username ?? OWNER;
  const created = await SELF.fetch('https://example.com/user/volumes', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ owner: ownerHandle, name: VOLUME }),
  });
  expect([201, 400]).toContain(created.status);
}

async function mintCredential(name: string): Promise<{ username: string; password: string; credentialId: string }> {
  const res = await SELF.fetch(`https://example.com/user/volumes/${ownerHandle}/${VOLUME}/credentials`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { username: string; password: string; credentialId: string };
}

const basic = (username: string, password: string): string => `Basic ${btoa(`${username}:${password}`)}`;

describe('bucket credential auth over real D1', () => {
  it('accepts a freshly minted pbkdf2 credential', async () => {
    await ensureVolume();
    const cred = await mintCredential('pbf-new');
    const res = await SELF.fetch(`https://example.com/${ownerHandle}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Authorization: basic(cred.username, cred.password), Depth: '0' },
    });
    expect(res.status).toBe(207);
  });

  it('stores a salted pbkdf2 hash, never the legacy digest', async () => {
    const cred = await mintCredential('pbf-format');
    const testEnv = env as unknown as TestEnv;
    const row = await testEnv.DB.prepare('SELECT password_hash FROM dav_credentials WHERE credential_id = ?')
      .bind(cred.credentialId)
      .first<{ password_hash: string }>();
    expect(row?.password_hash).toMatch(/^pbkdf2-sha256\$\d+\$/u);
    expect(row?.password_hash).not.toBe(cred.password);
  });

  it('rejects a wrong password', async () => {
    const cred = await mintCredential('pbf-wrong');
    const res = await SELF.fetch(`https://example.com/${ownerHandle}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Authorization: basic(cred.username, `${cred.password}x`), Depth: '0' },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/^Basic\b/u);
  });

  it('rejects an unknown username', async () => {
    const res = await SELF.fetch(`https://example.com/${ownerHandle}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Authorization: basic('no-such-user-xyz', 'whatever'), Depth: '0' },
    });
    expect(res.status).toBe(401);
  });

  it('does not upgrade a credential on a failed attempt', async () => {
    // Otherwise an attacker who knows a username can trigger hash rewrites just
    // by guessing wrong.
    const cred = await mintCredential('pbf-noupgrade');
    const testEnv = env as unknown as TestEnv;
    const before = await testEnv.DB.prepare('SELECT password_hash FROM dav_credentials WHERE credential_id = ?')
      .bind(cred.credentialId)
      .first<{ password_hash: string }>();
    await SELF.fetch(`https://example.com/${ownerHandle}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Authorization: basic(cred.username, 'wrong'), Depth: '0' },
    });
    const after = await testEnv.DB.prepare('SELECT password_hash FROM dav_credentials WHERE credential_id = ?')
      .bind(cred.credentialId)
      .first<{ password_hash: string }>();
    expect(after?.password_hash).toBe(before?.password_hash);
  });

  it('upgrades a legacy sha256 credential on first successful use', async () => {
    // Simulates a row written before the migration: an unsalted digest that must
    // keep working, and be silently rehashed so the migration completes without
    // asking anyone to reset a password.
    const cred = await mintCredential('pbf-legacy');
    const testEnv = env as unknown as TestEnv;
    const legacy = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cred.password));
    const legacyHex = [...new Uint8Array(legacy)].map((b) => b.toString(16).padStart(2, '0')).join('');
    await testEnv.DB.prepare('UPDATE dav_credentials SET password_hash = ? WHERE credential_id = ?')
      .bind(legacyHex, cred.credentialId)
      .run();

    const res = await SELF.fetch(`https://example.com/${ownerHandle}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Authorization: basic(cred.username, cred.password), Depth: '0' },
    });
    expect(res.status).toBe(207);

    const after = await testEnv.DB.prepare('SELECT password_hash FROM dav_credentials WHERE credential_id = ?')
      .bind(cred.credentialId)
      .first<{ password_hash: string }>();
    expect(after?.password_hash).toMatch(/^pbkdf2-sha256\$/u);
    // And the upgraded hash still verifies the original password.
    await expect(DavCredentialUtil.verifyPassword(cred.password, after?.password_hash ?? '')).resolves.toMatchObject({ ok: true });
  });

  it('rejects a credential whose stored hash is corrupt, without a 500', async () => {
    // A malformed row is unusable either way; answering 401 lets the client mint
    // a fresh credential instead of showing an opaque error.
    const cred = await mintCredential('pbf-corrupt');
    const testEnv = env as unknown as TestEnv;
    await testEnv.DB.prepare('UPDATE dav_credentials SET password_hash = ? WHERE credential_id = ?')
      .bind('garbage-not-a-hash', cred.credentialId)
      .run();
    const res = await SELF.fetch(`https://example.com/${ownerHandle}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Authorization: basic(cred.username, cred.password), Depth: '0' },
    });
    expect(res.status).toBe(401);
  });

  it('does not let a valid credential for one bucket open another', async () => {
    // Bucket credentials are bound to a volume id (CalDAV-style); username
    // validity alone must not cross the boundary.
    const cred = await mintCredential('pbf-bound');
    const other = await SELF.fetch('https://example.com/user/volumes', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ owner: ownerHandle, name: `${VOLUME}-2` }),
    });
    expect([201, 400]).toContain(other.status);
    const res = await SELF.fetch(`https://example.com/${ownerHandle}/${VOLUME}-2/`, {
      method: 'PROPFIND',
      headers: { Authorization: basic(cred.username, cred.password), Depth: '0' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects an expired credential', async () => {
    const cred = await mintCredential('pbf-expired');
    const testEnv = env as unknown as TestEnv;
    await testEnv.DB.prepare('UPDATE dav_credentials SET expires_at = ? WHERE credential_id = ?')
      .bind(1, cred.credentialId)
      .run();
    const res = await SELF.fetch(`https://example.com/${ownerHandle}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Authorization: basic(cred.username, cred.password), Depth: '0' },
    });
    expect(res.status).toBe(401);
  });
});
