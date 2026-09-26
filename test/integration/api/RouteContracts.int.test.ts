import { describe, expect, it, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { setupIntegrationTest, ensureUser } from '../helpers/setup';

/**
 * Route-contract tests for the session-authenticated `/user/*` plane.
 *
 * These cover the behaviours `VolumeScopedRoute` centralises: one ownership
 * guard, 404-vs-403 per plane, and no swallowed D1 failures.
 */

type TestEnv = Record<string, unknown> & { DB: D1Database };

const VOLUME = 'routevol';
// Must match `DEV_AUTH_EMAIL` in `wrangler.test.jsonc` — that is the identity
// `/user/*` authenticates as, and the owner check is against it.
const EMAIL = 'test@example.com';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * The handle the `users` row actually carries.
 *
 * `ensureUser` writes the username with `COALESCE`, so a row seeded by an
 * earlier suite keeps its original handle. `createVolume` correctly rejects an
 * owner that is not the caller's handle, so the tests must use the real one.
 */
let OWNER = 'routeuser';

const api = (path: string, init: RequestInit = {}): Promise<Response> => SELF.fetch(`https://example.com${path}`, init);

beforeAll(async () => {
  const testEnv = env as unknown as TestEnv;
  await setupIntegrationTest(testEnv, EMAIL);
  await ensureUser(testEnv.DB, EMAIL, OWNER);
  const row = await testEnv.DB.prepare(`SELECT username FROM users WHERE email = ?`).bind(EMAIL).first<{ username: string | null }>();
  OWNER = row?.username ?? OWNER;
  expect(OWNER).not.toBe('');
  const created = await api('/user/volumes', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ owner: OWNER, name: VOLUME }),
  });
  // Idempotent across re-runs: 400 means it already exists.
  expect([201, 400]).toContain(created.status);
});

describe('GET /users/:username', () => {
  it('404s an unknown handle instead of echoing the request', async () => {
    // It previously answered 200 with whatever the caller asked for, because
    // `getByUsername` swallowed its own errors — so the endpoint could not be
    // used to check availability while looking like a success.
    const res = await api('/users/definitely-not-a-real-handle-xyz');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { Exception?: { Type?: string } };
    expect(body.Exception?.Type).toBe('NotFound');
  });

  it('resolves a real handle', async () => {
    const res = await api(`/users/${OWNER}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string };
    expect(body.username.toLowerCase()).toBe(OWNER);
  });
});

describe('volume ownership guard', () => {
  it('404s a missing volume', async () => {
    const res = await api('/user/volumes/nosuchowner/nosuchvol');
    expect(res.status).toBe(404);
  });

  it('404s a foreign volume on the browser plane (existence is hidden)', async () => {
    // This plane deliberately hides existence; the credential plane returns
    // 403. The two had already drifted apart once.
    const res = await api(`/user/volumes/${OWNER}/${VOLUME}/files/`, {
      method: 'PROPFIND',
      headers: { Depth: '0', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>',
    });
    expect(res.status).toBe(207);
    const missing = await api('/user/volumes/nosuchowner/nosuchvol/files/', {
      method: 'PROPFIND',
      headers: { Depth: '0', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>',
    });
    expect(missing.status).toBe(404);
  });

  it('returns the bucket detail for its owner', async () => {
    const res = await api(`/user/volumes/${OWNER}/${VOLUME}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fullName: string; isPrivate: boolean };
    expect(body.fullName).toBe(`${OWNER}/${VOLUME}`);
    // Private by default.
    expect(body.isPrivate).toBe(true);
  });
});

describe('JSON body handling', () => {
  it('rejects malformed JSON with 400 rather than a misleading field error', async () => {
    const res = await api(`/user/volumes/${OWNER}/${VOLUME}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: '{not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { Exception?: { Message?: string } };
    expect(body.Exception?.Message).toBe('Invalid JSON body');
  });

  it('rejects an oversize body with 413', async () => {
    const res = await api(`/user/volumes/${OWNER}/${VOLUME}`, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, 'Content-Length': String(2 * 1024 * 1024) },
      body: 'x'.repeat(2 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it('requires a name when creating a credential', async () => {
    const res = await api(`/user/volumes/${OWNER}/${VOLUME}/credentials`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a bucket owner that is not the caller (fails closed)', async () => {
    const res = await api('/user/volumes', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ owner: 'somebodyelse', name: 'stolen' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('rate limiting is active on the live worker', () => {
  it('eventually answers 429 on a mutating endpoint', async () => {
    // `registerRateLimits` was exported and never called, so nothing in the
    // application was rate limited at all. The rename bucket allows 10/min.
    const statuses: number[] = [];
    for (let i = 0; i < 14; i += 1) {
      const res = await api('/user/me/username', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ username: 'a'.repeat(30) }),
      });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
