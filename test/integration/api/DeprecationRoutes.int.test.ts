import { describe, expect, it, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { setupIntegrationTest, ensureUser } from '../helpers/setup';
import { ROUTER_REPO_URL } from '../../../apps/api/src/workers/deprecationNotice';

/**
 * The built-in web UI is soft-deprecated: the worker answers the home page with
 * a standalone notice, the old SPA document routes no longer exist, and volume
 * navigations reach the DO's own collection HTML rather than a client-side view.
 */

type TestEnv = Record<string, unknown> & { DB: D1Database };

const VOLUME = 'deprecvol';
const EMAIL = 'test@example.com';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let OWNER = 'deprecuser';

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
  expect([201, 400]).toContain(created.status);
  // A public bucket lets the DO answer an unauthenticated browser navigation.
  const patched = await api(`/user/volumes/${OWNER}/${VOLUME}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ isPrivate: false }),
  });
  expect(patched.status).toBe(200);
  // One child so the DO listing has an <a href> to assert on; the session
  // plane writes as the owner without a Basic credential.
  const put = await api(`/user/volumes/${OWNER}/${VOLUME}/files/note.txt`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: 'hello',
  });
  expect([201, 204]).toContain(put.status);
});

describe('soft-deprecated web UI routes', () => {
  it('serves a standalone notice at / with the Router repository link', async () => {
    const res = await api('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toContain(ROUTER_REPO_URL);
    const html = await res.text();
    expect(html).toContain(ROUTER_REPO_URL);
    expect(html).toMatch(/deprecated/i);
  });

  it('has no SPA document routes left', async () => {
    for (const path of ['/new', '/settings', '/a-profile-handle']) {
      const res = await api(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('falls through to the DO collection listing on a volume navigation', async () => {
    const res = await api(`/${OWNER}/${VOLUME}/`, { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    // The DO's renderCollectionHtml uses <a href>, not a DAV:href multistatus
    // and not the SPA shell's asset bundles.
    expect(html).toContain('<a href=');
    expect(html).not.toContain('/assets/');
  });
});
