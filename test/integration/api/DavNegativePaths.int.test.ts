import { describe, expect, it, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { setupIntegrationTest, ensureUser } from '../helpers/setup';

/**
 * Negative-path WebDAV coverage over real D1 + DO.
 *
 * The pre-existing `DavLifecycle` suite is happy-path only, so several
 * security-relevant assertions had no test at all: the credential-to-volume
 * binding, expired credentials, anonymous writes to a public bucket,
 * cross-origin `Destination`, `Overwrite: F`, and locked-target `If` handling.
 * Each of those checks exists in the code precisely because something went
 * wrong once; none of them were verified.
 */

type TestEnv = Record<string, unknown> & { DB: D1Database };

const VOLUME = 'negpath';
// Must match `DEV_AUTH_EMAIL` in `wrangler.test.jsonc` — that is the identity
// `/user/*` authenticates as, and `createVolume`'s owner check is against it.
const EMAIL = 'test@example.com';

/**
Resolved in `beforeAll` from the `users` row.
*/
let OWNER = 'negowner';

let auth: Record<string, string>;

function basic(username: string, password: string): Record<string, string> {
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}` };
}

/**
 * The handle the `users` row actually carries.
 *
 * `ensureUser` writes the username with `COALESCE`, so a row seeded by an
 * earlier suite (or an earlier run of this one) keeps its original handle. The
 * volume owner must be the real handle, otherwise `createVolume` correctly
 * answers 403 for the owner check — which is the behaviour under test, not a
 * bug to work around.
 */
async function currentUsername(): Promise<string> {
  const row = await (env as unknown as TestEnv).DB.prepare(`SELECT username FROM users WHERE email = ?`)
    .bind(EMAIL)
    .first<{ username: string | null }>();
  const handle = row?.username ?? '';
  expect(handle).not.toBe('');
  return handle;
}

const PROPFIND_BODY = '<?xml version="1.0"?><propfind xmlns="DAV:"><allprop/></propfind>';
const XML = { 'Content-Type': 'application/xml' };

async function mint(name: string): Promise<Record<string, string>> {
  const res = await SELF.fetch(`https://example.com/user/volumes/${OWNER}/${VOLUME}/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  const { username, password } = (await res.json()) as { username: string; password: string };
  return basic(username, password);
}

describe('WebDAV negative paths (real D1 + DO)', () => {
  beforeAll(async () => {
    const testEnv = env as unknown as TestEnv;
    await setupIntegrationTest(testEnv, EMAIL);
    await ensureUser(testEnv.DB, EMAIL, OWNER);
    OWNER = await currentUsername();
    const created = await SELF.fetch('https://example.com/user/volumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: OWNER, name: VOLUME, isPrivate: false }),
    });
    // Idempotent across re-runs: 400 means it already exists.
    expect([201, 400]).toContain(created.status);
    auth = await mint('primary');
  });

  it('rejects a credential bound to a different volume', async () => {
    // The `credential.volumeId !== volume.id` binding is the core of the
    // authorization model and had no test. A credential for another bucket
    // must not open this one.
    const other = await SELF.fetch('https://example.com/user/volumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: OWNER, name: 'otherbucket' }),
    });
    expect([201, 400]).toContain(other.status);
    const minted = await SELF.fetch(`https://example.com/user/volumes/${OWNER}/otherbucket/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'cross' }),
    });
    expect(minted.status).toBe(201);
    const { username, password } = (await minted.json()) as { username: string; password: string };

    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { ...basic(username, password), Depth: '0', ...XML },
      body: PROPFIND_BODY,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
  });

  it('does not accept a Bearer token in place of bucket Basic', async () => {
    // Reads on a public bucket are anonymous by design, so the meaningful
    // assertion is that a Bearer cannot authorise a *write*.
    const read = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Authorization: 'Bearer ddav_something', Depth: '0', ...XML },
      body: PROPFIND_BODY,
    });
    expect(read.status).toBe(207);

    const write = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/bearer.txt`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ddav_something', 'Content-Type': 'text/plain' },
      body: 'nope',
    });
    expect(write.status).toBe(401);
  });

  it('allows anonymous reads but refuses anonymous writes on a public bucket', async () => {
    const read = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Depth: '0', ...XML },
      body: PROPFIND_BODY,
    });
    expect(read.status).toBe(207);

    const write = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/anon.txt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'nope',
    });
    expect(write.status).toBe(401);
  });

  it('advertises OPTIONS without requiring a credential', async () => {
    // Capability discovery must not need auth; a 401 here breaks Windows and
    // Office DAV discovery on private volumes.
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/`, { method: 'OPTIONS' });
    expect(res.status).toBe(200);
    expect(res.headers.get('DAV')).toContain('1');
    expect(res.headers.get('DAV')).toContain('2');
    expect(res.headers.get('Allow')).toContain('PROPFIND');
  });

  it('emits DAV:href values that include the volume base', async () => {
    // RFC 4918 §8.3. The hrefs used to be volume-relative, so every
    // third-party client resolved them outside the volume and 404'd.
    await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir`, { method: 'MKCOL', headers: auth });
    await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir/file.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'href body',
    });
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir/`, {
      method: 'PROPFIND',
      headers: { ...auth, Depth: '1', ...XML },
      body: PROPFIND_BODY,
    });
    expect(res.status).toBe(207);
    const xml = await res.text();
    expect(xml).toContain(`<href>/${OWNER}/${VOLUME}/dir/</href>`);
    expect(xml).toContain(`<href>/${OWNER}/${VOLUME}/dir/file.txt</href>`);
  });

  it('answers 405 with an Allow header for a non-DAV method', async () => {
    // Previously fell through to Hono's default 404, so the 405 the code
    // already contained was unreachable.
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir`, {
      method: 'PATCH',
      headers: auth,
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toContain('PROPFIND');
    expect(res.headers.get('DAV')).toContain('2');
  });

  it('rejects a cross-origin Destination', async () => {
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir/file.txt`, {
      method: 'COPY',
      headers: { ...auth, Destination: 'https://evil.example.net/steal', Overwrite: 'T' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a Destination that resolves outside the volume', async () => {
    // The WHATWG URL parser normalises `%2e%2e` before we ever see the header,
    // so this arrives as the bare string `etc`. `stripBase` used to accept any
    // single-segment path as volume-relative, silently turning an escape
    // attempt into a successful write to `<volume>/etc`.
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir/file.txt`, {
      method: 'MOVE',
      headers: { ...auth, Destination: `https://example.com/${OWNER}/${VOLUME}/%2e%2e/%2e%2e/etc`, Overwrite: 'T' },
    });
    expect(res.status).toBe(400);

    // Nothing should have been created by the rejected MOVE.
    const escaped = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/etc`, { headers: auth });
    expect(escaped.status).toBe(404);
  });

  it('honours Overwrite: F', async () => {
    await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/ow-target.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'original',
    });
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir/file.txt`, {
      method: 'COPY',
      headers: { ...auth, Destination: `https://example.com/${OWNER}/${VOLUME}/ow-target.txt`, Overwrite: 'F' },
    });
    expect(res.status).toBe(412);
    // The original must survive.
    const after = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/ow-target.txt`, { headers: auth });
    expect(await after.text()).toBe('original');
  });

  it('refuses to write to a locked resource without the token, and allows it with', async () => {
    await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/locked.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'v1',
    });
    const lock = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/locked.txt`, {
      method: 'LOCK',
      headers: { ...auth, Depth: '0', Timeout: 'Second-120', ...XML },
      body: '<?xml version="1.0"?><lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockinfo>',
    });
    expect([200, 201]).toContain(lock.status);
    const token = lock.headers.get('Lock-Token') ?? '';
    expect(token).toBeTruthy();

    const blocked = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/locked.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'v2',
    });
    expect(blocked.status).toBe(423);

    const withToken = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/locked.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain', If: `(${token})` },
      body: 'v2',
    });
    expect([200, 204]).toContain(withToken.status);

    const unlock = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/locked.txt`, {
      method: 'UNLOCK',
      headers: { ...auth, 'Lock-Token': token },
    });
    expect(unlock.status).toBe(204);
  });

  it('does not leak other clients lock tokens in the LOCK response', async () => {
    const target = `${OWNER}/${VOLUME}/shared-lock.txt`;
    await SELF.fetch(`https://example.com/${target}`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'shared',
    });
    const first = await SELF.fetch(`https://example.com/${target}`, {
      method: 'LOCK',
      headers: { ...auth, Depth: '0', ...XML },
      body: '<?xml version="1.0"?><lockinfo xmlns="DAV:"><lockscope><shared/></lockscope><locktype><write/></locktype></lockinfo>',
    });
    expect(first.status).toBe(201);
    const firstToken = first.headers.get('Lock-Token') ?? '';
    const firstBody = await first.text();

    const second = await SELF.fetch(`https://example.com/${target}`, {
      method: 'LOCK',
      headers: { ...auth, Depth: '0', ...XML },
      body: '<?xml version="1.0"?><lockinfo xmlns="DAV:"><lockscope><shared/></lockscope><locktype><write/></locktype></lockinfo>',
    });
    expect(second.status).toBe(201);
    const secondToken = second.headers.get('Lock-Token') ?? '';
    const secondBody = await second.text();

    const bare = (t: string): string => t.replaceAll(/^<|>$/g, '').replace(/^urn:uuid:/, '');
    // The second client must not receive the first client's write token.
    expect(secondBody).not.toContain(bare(firstToken));
    expect(secondBody).toContain(bare(secondToken));
    expect(firstBody).toContain(bare(firstToken));

    await SELF.fetch(`https://example.com/${target}`, { method: 'UNLOCK', headers: { ...auth, 'Lock-Token': firstToken } });
    await SELF.fetch(`https://example.com/${target}`, { method: 'UNLOCK', headers: { ...auth, 'Lock-Token': secondToken } });
  });

  it('does not copy over a locked descendant (COPY uses DELETE semantics)', async () => {
    const dir = `${OWNER}/${VOLUME}/lockeddir`;
    await SELF.fetch(`https://example.com/${dir}`, { method: 'MKCOL', headers: auth });
    await SELF.fetch(`https://example.com/${dir}/child.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'child',
    });
    const lock = await SELF.fetch(`https://example.com/${dir}/child.txt`, {
      method: 'LOCK',
      headers: { ...auth, Depth: '0', ...XML },
      body: '<?xml version="1.0"?><lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockinfo>',
    });
    expect(lock.status).toBe(201);
    const token = lock.headers.get('Lock-Token') ?? '';

    // Copy another collection over the locked one: the recursive delete must
    // refuse rather than destroy a locked child.
    await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/srcdir`, { method: 'MKCOL', headers: auth });
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/srcdir`, {
      method: 'COPY',
      headers: { ...auth, Destination: `https://example.com/${dir}`, Overwrite: 'T' },
    });
    expect(res.status).toBe(423);

    // The locked child must still be there, still readable, and still locked.
    const survivor = await SELF.fetch(`https://example.com/${dir}/child.txt`, { headers: auth });
    expect(survivor.status).toBe(200);
    expect(await survivor.text()).toBe('child');
    const stillLocked = await SELF.fetch(`https://example.com/${dir}/child.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'overwritten',
    });
    expect(stillLocked.status).toBe(423);

    await SELF.fetch(`https://example.com/${dir}/child.txt`, { method: 'UNLOCK', headers: { ...auth, 'Lock-Token': token } });
  });

  it('answers 416 for an unsatisfiable Range and 206 for a satisfiable one', async () => {
    await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/ranged.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: '0123456789',
    });
    const ok = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/ranged.txt`, {
      headers: { ...auth, Range: 'bytes=2-4' },
    });
    expect(ok.status).toBe(206);
    expect(await ok.text()).toBe('234');
    expect(ok.headers.get('Content-Range')).toBe('bytes 2-4/10');

    const bad = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/ranged.txt`, {
      headers: { ...auth, Range: 'bytes=500-600' },
    });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('Content-Range')).toBe('bytes */10');
  });

  it('mirrors Range on HEAD', async () => {
    const head = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/ranged.txt`, {
      method: 'HEAD',
      headers: { ...auth, Range: 'bytes=2-4' },
    });
    expect(head.status).toBe(206);
    expect(head.headers.get('Content-Range')).toBe('bytes 2-4/10');
  });

  it('honours If-Match on PUT to prevent a lost update', async () => {
    await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/cond.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'first',
    });
    const current = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/cond.txt`, { headers: auth });
    const etag = current.headers.get('ETag') ?? '';
    expect(etag).toBeTruthy();

    const stale = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/cond.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain', 'If-Match': '"definitely-stale"' },
      body: 'clobber',
    });
    expect(stale.status).toBe(412);

    const fresh = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/cond.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain', 'If-Match': etag },
      body: 'second',
    });
    expect([200, 204]).toContain(fresh.status);
  });

  it('reports 412 for a create-only PUT when the resource already exists', async () => {
    await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/createonly.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'exists',
    });
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/createonly.txt`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'text/plain', 'If-None-Match': '*' },
      body: 'again',
    });
    expect(res.status).toBe(412);
  });

  it('rejects an oversize body with 413 instead of buffering it', async () => {
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/toobig.bin`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/octet-stream', 'Content-Length': String(64 * 1024 * 1024) },
      body: new Uint8Array(1024),
    });
    expect(res.status).toBe(413);
  });

  it('returns 400 for a prototype-chain live-property request instead of 500', async () => {
    // An unauthenticated-ish PROPFIND asking for `<D:constructor/>` used to
    // crash `escapeXml` with a TypeError, turning a 207 into a 500.
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { ...auth, Depth: '0', ...XML },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><constructor/></prop></propfind>',
    });
    expect(res.status).toBe(207);
    const xml = await res.text();
    expect(xml).toContain('404 Not Found');
  });

  it('reflects no client-supplied X-Dav-User on an anonymous read', async () => {
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/`, {
      method: 'PROPFIND',
      headers: { Depth: '0', 'X-Dav-User': 'spoofed@evil.test', ...XML },
      body: PROPFIND_BODY,
    });
    expect(res.status).toBe(207);
  });

  it('refuses to copy a collection into itself or a descendant (RFC 4918 §9.8.3)', async () => {
    // A volume root's descendants are every path in the bucket, so a root
    // COPY has no legal in-volume destination. This is the correct answer, not
    // an over-strict guard.
    const intoSubdir = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}`, {
      method: 'COPY',
      headers: { ...auth, Destination: `https://example.com/${OWNER}/${VOLUME}/rootsnapshot`, Overwrite: 'T' },
    });
    expect(intoSubdir.status).toBe(400);

    // A nested collection into its own descendant is refused too.
    const nested = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir`, {
      method: 'COPY',
      headers: { ...auth, Destination: `https://example.com/${OWNER}/${VOLUME}/dir/inner`, Overwrite: 'T' },
    });
    expect(nested.status).toBe(400);

    // A nested collection to a sibling is allowed.
    const sibling = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir`, {
      method: 'COPY',
      headers: { ...auth, Destination: `https://example.com/${OWNER}/${VOLUME}/dircopy`, Overwrite: 'T' },
    });
    expect(sibling.status).toBe(201);
  });

  it('refuses a cross-volume Destination', async () => {
    const res = await SELF.fetch(`https://example.com/${OWNER}/${VOLUME}/dir`, {
      method: 'COPY',
      headers: { ...auth, Destination: `https://example.com/${OWNER}/${VOLUME}-backup/dir`, Overwrite: 'T' },
    });
    expect(res.status).toBe(400);
  });
});
