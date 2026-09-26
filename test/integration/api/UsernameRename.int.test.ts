import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupIntegrationTest } from '../helpers/setup';

const USER = 'test@example.com';
const OWNER = 'test';
const VOLUME = 'rename-cascade';

type TestEnv = Record<string, unknown> & { DB: D1Database };

function api(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, init);
}

function json(init?: RequestInit): RequestInit {
  return { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } };
}

describe('username rename on real D1+DO', () => {
  beforeAll(async () => {
    await setupIntegrationTest(env as unknown as TestEnv, USER);
    const created = await api('/user/volumes', json({ method: 'POST', body: JSON.stringify({ owner: OWNER, name: VOLUME }) }));
    expect([200, 201, 400]).toContain(created.status);
    // Seed volume content so the rename has something to move.
    const put = await api(`/user/volumes/${OWNER}/${VOLUME}/files/README.md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello rename',
    });
    expect([200, 201, 204]).toContain(put.status);
  });

  it('exposes the bootstrapped identity', async () => {
    const me = (await (await api('/user/me')).json()) as { email: string; username: string | null };
    expect(me.email).toBe(USER);
    expect(me.username).toBeTruthy();
  });

  it('rejects reserved and malformed handles', async () => {
    for (const bad of ['user', 'new', '-dash', 'a..b']) {
      const res = await api('/user/me/username', json({ method: 'PATCH', body: JSON.stringify({ username: bad }) }));
      expect(res.status).toBe(400);
    }
  });

  it('renames and cascades owned volumes to the new owner', async () => {
    const next = 'renamed-owner';
    const res = await api('/user/me/username', json({ method: 'PATCH', body: JSON.stringify({ username: next }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; username: string };
    expect(body).toMatchObject({ email: USER, username: next });

    const me = (await (await api('/user/me')).json()) as { username: string };
    expect(me.username).toBe(next);

    // D1 cascade: the volume moved to the new owner namespace.
    expect((await api(`/user/volumes/${next}/${VOLUME}`)).status).toBe(200);
    expect((await api(`/user/volumes/${OWNER}/${VOLUME}`)).status).toBe(404);

    // DO move: file bytes survived under the new owner, old isolate is gone.
    const moved = await api(`/user/volumes/${next}/${VOLUME}/files/README.md`);
    expect(moved.status).toBe(200);
    expect(await moved.text()).toBe('hello rename');
    expect((await api(`/user/volumes/${OWNER}/${VOLUME}/files/README.md`)).status).toBe(404);

    // Profile lookup follows the new handle.
    expect((await api(`/users/${next}`)).status).toBe(200);
  });

  it('is idempotent for the current handle', async () => {
    const res = await api('/user/me/username', json({ method: 'PATCH', body: JSON.stringify({ username: 'renamed-owner' }) }));
    expect(res.status).toBe(200);
  });
});
