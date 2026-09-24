import { describe, expect, it, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { setupIntegrationTest, ensureUser } from '../helpers/setup';

describe('DuraDAV lifecycle (volumes + WebDAV Class 1/2)', () => {
  beforeAll(async () => {
    const testEnv = env as unknown as { DB: D1Database } & Record<string, unknown>;
    await setupIntegrationTest(testEnv, 'test@example.com');
    await ensureUser(testEnv.DB, 'test@example.com', 'test');
  });

  it('health reports duradav', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service: string };
    expect(body.service).toBe('duradav');
  });

  it('creates a volume and speaks OPTIONS/PROPFIND (Class 1)', async () => {
    const create = await SELF.fetch('https://example.com/user/volumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: 'test', name: 'photos', isPrivate: false }),
    });
    expect([201, 400]).toContain(create.status);

    const options = await SELF.fetch('https://example.com/test/photos/', { method: 'OPTIONS' });
    expect(options.status).toBe(200);
    expect(options.headers.get('DAV')).toContain('1');
    expect(options.headers.get('DAV')).toContain('2');

    const propfind = await SELF.fetch('https://example.com/test/photos/', {
      method: 'PROPFIND',
      headers: { Depth: '0', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>',
    });
    expect(propfind.status).toBe(207);
    const xml = await propfind.text();
    expect(xml).toContain('multistatus');
    expect(xml).toContain('resourcetype');
  });

  it('PUT/GET/MKCOL round-trip', async () => {
    const mkcol = await SELF.fetch('https://example.com/test/photos/dir', { method: 'MKCOL' });
    expect([201, 405]).toContain(mkcol.status);

    const put = await SELF.fetch('https://example.com/test/photos/dir/hello.txt', {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello duradav',
    });
    expect([201, 204]).toContain(put.status);

    const get = await SELF.fetch('https://example.com/test/photos/dir/hello.txt');
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('hello duradav');
  });

  it('LOCK/UNLOCK round-trip (Class 2)', async () => {
    const lock = await SELF.fetch('https://example.com/test/photos/dir/hello.txt', {
      method: 'LOCK',
      headers: { Depth: '0', Timeout: 'Second-60', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockinfo>',
    });
    expect([200, 201]).toContain(lock.status);
    const token = lock.headers.get('Lock-Token');
    expect(token).toBeTruthy();

    const unlock = await SELF.fetch('https://example.com/test/photos/dir/hello.txt', {
      method: 'UNLOCK',
      headers: { 'Lock-Token': token ?? '' },
    });
    expect(unlock.status).toBe(204);
  });
});
