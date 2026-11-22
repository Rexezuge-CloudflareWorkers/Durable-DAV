import { beforeAll, describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { setupIntegrationTest, ensureUser } from '../helpers/setup';

/**
 * Server credentials over the real worker and D1.
 *
 * A server credential is only meaningful if three halves agree: the migration
 * adds the column, the service stores the far-future sentinel, and the auth
 * lookup still accepts the row. A unit test can pin the first two; this one
 * drives a real POST and then a real WebDAV request with the returned secret.
 * The projection is asserted too, because the sentinel is deliberately *not*
 * published — clients see `expiresAt: null` and render "Never".
 */

type TestEnv = Record<string, unknown> & { DB: D1Database };

const OWNER = 'svowner';
const VOLUME = 'sv-vol';
const EMAIL = 'test@example.com';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let ownerHandle = OWNER;

beforeAll(async () => {
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
});

interface MintedCredential {
  credentialId: string;
  name: string;
  username: string;
  password: string;
  expiresAt: number | null;
  isServer: boolean;
  readOnly: boolean;
}

function mintCredential(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://example.com/user/volumes/${ownerHandle}/${VOLUME}/credentials`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

const basic = (username: string, password: string): string => `Basic ${btoa(`${username}:${password}`)}`;

function dav(method: string, cred: MintedCredential, path: string, body?: string): Promise<Response> {
  return SELF.fetch(`https://example.com/${ownerHandle}/${VOLUME}/${path}`, {
    method,
    headers: { Authorization: basic(cred.username, cred.password) },
    body,
  });
}

describe('server credentials over the real API and DAV plane', () => {
  it('mints a flagged, never-expiring credential and stores the sentinel', async () => {
    const res = await mintCredential({ name: 'daemon', server: true });
    expect(res.status).toBe(201);
    const cred = (await res.json()) as MintedCredential;
    expect(cred.isServer).toBe(true);
    expect(cred.expiresAt).toBeNull();
    expect(cred.password.startsWith('ddav_')).toBe(true);

    const testEnv = env as unknown as TestEnv;
    const row = await testEnv.DB.prepare('SELECT is_server, expires_at FROM dav_credentials WHERE credential_id = ?')
      .bind(cred.credentialId)
      .first<{ is_server: number; expires_at: number }>();
    expect(row?.is_server).toBe(1);
    expect(row?.expires_at).toBe(253_402_300_799);
  });

  it('authenticates WebDAV requests with the long-lived credential', async () => {
    const res = await mintCredential({ name: 'daemon-dav', server: true });
    expect(res.status).toBe(201);
    const cred = (await res.json()) as MintedCredential;

    expect([201, 204]).toContain((await dav('PUT', cred, 'server-cred.txt', 'persistent')).status);
    const get = await dav('GET', cred, 'server-cred.txt');
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('persistent');
  });

  it('honors read-only on a server credential', async () => {
    const res = await mintCredential({ name: 'daemon-ro', server: true, readOnly: true });
    expect(res.status).toBe(201);
    const cred = (await res.json()) as MintedCredential;
    expect(cred.isServer).toBe(true);
    expect(cred.readOnly).toBe(true);

    const put = await dav('PUT', cred, 'server-ro.txt', 'nope');
    expect(put.status).toBe(403);
    expect(put.headers.get('WWW-Authenticate')).toBeNull();
  });

  it('allows several server credentials on the same bucket', async () => {
    const a = await mintCredential({ name: 'daemon-a', server: true });
    const b = await mintCredential({ name: 'daemon-b', server: true });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(((await a.json()) as MintedCredential).isServer).toBe(true);
    expect(((await b.json()) as MintedCredential).isServer).toBe(true);
  });

  it('lists the server flag with a null expiry', async () => {
    const minted = await mintCredential({ name: 'daemon-list', server: true });
    expect(minted.status).toBe(201);
    const cred = (await minted.json()) as MintedCredential;

    const res = await SELF.fetch(`https://example.com/user/volumes/${ownerHandle}/${VOLUME}/credentials`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credentials: MintedCredential[] };
    const listed = body.credentials.find((c) => c.credentialId === cred.credentialId);
    expect(listed).toMatchObject({ isServer: true, expiresAt: null });
  });

  it('rejects a non-boolean server flag instead of minting an ordinary credential', async () => {
    for (const bad of ['true', 1, 'yes']) {
      const res = await mintCredential({ name: `daemon-bad-${String(bad)}`, server: bad });
      expect(res.status, `server: ${JSON.stringify(bad)} must be a 400`).toBe(400);
    }
  });

  it('leaves ordinary credentials time-boxed and unflagged', async () => {
    const res = await mintCredential({ name: 'laptop', expiresInDays: 7 });
    expect(res.status).toBe(201);
    const cred = (await res.json()) as MintedCredential;
    expect(cred.isServer).toBe(false);
    expect(cred.expiresAt).not.toBeNull();
    expect((cred.expiresAt as number) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(7 * 86_400);
  });
});
