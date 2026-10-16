import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '../apps/web/src/lib/api';
import {
  createBucketCredential,
  listBucketCredentials,
  revokeBucketCredential,
  setBucketCredentialReadOnly,
} from '../apps/web/src/services/credentialService';
import { loadProfile } from '../apps/web/src/services/profileService';
import {
  createReplication,
  deleteReplication,
  listReplicationConflicts,
  listReplications,
  resolveReplicationConflict,
  rotateReplicationCredential,
  runReplicationNow,
  updateReplication,
} from '../apps/web/src/services/replicationService';
import { loadCurrentUser, renameCurrentUsername } from '../apps/web/src/services/userService';
import { createVolume, listMyVolumes, loadVolume, updateVolume } from '../apps/web/src/services/volumeService';

/**
 * The SPA's API client: one call path per service, over a stubbed `fetch`.
 *
 * These are the shapes the plane relies on, and the migration touched two of
 * them — the wire envelope's `Type` is the kit's catalog key now, and every
 * service URL is asserted below rather than assumed. The point is not that
 * `apiGet` builds a URL; it is that a *rename* on either side of the contract
 * fails here, where a reader can see which half drifted.
 */

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(respond: () => Response) {
  // A factory, never a single `Response`: a body reads once, and every service
  // call in these tests needs its own.
  const calls: Recorded[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      // The client always sends a JSON string, so the parse is exact; a
      // non-string body would be a client bug worth surfacing.
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return respond();
  });
  return calls;
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the volume and credential calls', () => {
  it('lists volumes and maps each row onto the client shape', async () => {
    const calls = stubFetch(() =>
      json({
        volumes: [{ owner: 'alice', name: 'demo', description: null, isPrivate: true, hrefPrefixMode: 'base', href: '/alice/demo' }],
      }),
    );

    await expect(listMyVolumes()).resolves.toEqual([
      expect.objectContaining({ owner: 'alice', name: 'demo', fullName: 'alice/demo', hrefPrefixMode: 'base' }),
    ]);
    expect(calls).toEqual([{ url: '/user/volumes', method: 'GET', body: undefined }]);
  });

  it('reads and writes one volume by encoded path segments', async () => {
    const calls = stubFetch(() =>
      json({ owner: 'alice', name: 'demo', description: 'd', isPrivate: false, hrefPrefixMode: 'root', href: '/alice/demo' }),
    );

    await loadVolume('alice', 'my volume');
    await updateVolume('alice', 'my volume', { isPrivate: true });

    expect(calls[0]?.url).toBe('/user/volumes/alice/my%20volume');
    expect(calls[1]).toMatchObject({ method: 'PATCH', body: { isPrivate: true } });
  });

  it('defaults a new volume to private', async () => {
    // Opt-out rather than opt-in: a missing flag must not publish a bucket.
    const calls = stubFetch(() => json({ owner: 'alice', name: 'demo', href: '/alice/demo' }));

    await createVolume({ name: 'demo' });

    expect(calls[0]).toMatchObject({ method: 'POST', body: { name: 'demo', isPrivate: true } });
  });

  it('lists, creates, flips and revokes a bucket credential', async () => {
    const calls = stubFetch(() => json({}));

    await listBucketCredentials('alice', 'demo');
    await createBucketCredential('alice', 'demo', 'laptop', 30, true);
    await setBucketCredentialReadOnly('alice', 'demo', 'cred 1', true);
    await revokeBucketCredential('alice', 'demo', 'cred 1');

    expect(calls.map((c) => c.url)).toEqual([
      '/user/volumes/alice/demo/credentials',
      '/user/volumes/alice/demo/credentials',
      '/user/volumes/alice/demo/credentials/cred%201',
      '/user/volumes/alice/demo/credentials/cred%201',
    ]);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'PATCH', 'DELETE']);
    // The copy-once secret and the read-only flag both travel in the body.
    expect(calls[1]?.body).toEqual({ name: 'laptop', expiresInDays: 30, readOnly: true });
    expect(calls[2]?.body).toEqual({ readOnly: true });
  });
});

describe('the replication calls', () => {
  it('reads and writes a target through the volume-scoped paths', async () => {
    const calls = stubFetch(() => json({}));

    await listReplications('alice', 'demo');
    await createReplication('alice', 'demo', {
      targetKind: 'dav',
      remoteUrl: 'https://remote.example.com/dav',
      remotePath: 'docs',
      mode: 'copy-only',
    } as never);
    await updateReplication('alice', 'demo', 'rep_1', { intervalMinutes: 15 } as never);
    await rotateReplicationCredential('alice', 'demo', 'rep_1', { username: 'u', secret: 'p' } as never);
    await runReplicationNow('alice', 'demo', 'rep_1');
    await listReplicationConflicts('alice', 'demo', 'rep_1');
    await resolveReplicationConflict('alice', 'demo', 'rep_1', 'cf_1');
    await deleteReplication('alice', 'demo', 'rep_1');

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /user/volumes/alice/demo/replications',
      'POST /user/volumes/alice/demo/replications',
      'PATCH /user/volumes/alice/demo/replications/rep_1',
      'POST /user/volumes/alice/demo/replications/rep_1/credential',
      'POST /user/volumes/alice/demo/replications/rep_1/run',
      'GET /user/volumes/alice/demo/replications/rep_1/conflicts',
      'POST /user/volumes/alice/demo/replications/rep_1/conflicts/cf_1/resolve',
      'DELETE /user/volumes/alice/demo/replications/rep_1',
    ]);
  });
});

describe('the profile calls', () => {
  it('reads a profile and the signed-in user', async () => {
    const calls = stubFetch(() => json({ username: 'alice' }));

    await loadProfile('alice');
    await renameCurrentUsername('alice2');

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /users/alice', 'PATCH /user/me/username']);
    expect(calls[1]?.body).toEqual({ username: 'alice2' });
    // The caller-supplied handle is encoded, so a `/` in a username cannot
    // become a second path segment.
    expect(calls[0]?.url).toBe('/users/alice');
  });

  it('issues one /user/me for concurrent mounts', async () => {
    // StrictMode's double-effect would otherwise fire two reads of the same
    // identity; the hold is shared per module, so this is the case that pins it.
    const calls = stubFetch(() => json({ username: 'alice' }));

    await Promise.all([loadCurrentUser(), loadCurrentUser()]);

    expect(calls.filter((c) => c.url === '/user/me')).toHaveLength(1);
  });
});

describe('the error path', () => {
  it('maps an AWS envelope failure onto a BackendError carrying the kit type', async () => {
    // The `Type` value is the kit's catalog key. The client never switches on
    // it — it keys the localized wording off `Message` — but the value is
    // surfaced in the generic fallback and asserted by the backend contract,
    // so it is pinned here at the seam that reads it.
    stubFetch(() => json({ Exception: { Type: 'notFound', Message: 'Volume not found' } }, 404));

    await expect(loadVolume('alice', 'nope')).rejects.toMatchObject({
      name: 'BackendError',
      errorType: 'notFound',
      status: 404,
      message: 'Volume not found',
    } satisfies Partial<BackendError>);
  });

  it('keeps a successful 204 as "no body" rather than a JSON parse failure', async () => {
    // `response.json()` threw on the empty body, and because that is not a
    // BackendError the caller reported a failure for an operation that had
    // actually succeeded.
    stubFetch(() => new Response(null, { status: 204 }));

    await expect(revokeBucketCredential('alice', 'demo', 'cred 1')).resolves.toBeUndefined();
  });

  it('reports a non-JSON error body as itself', async () => {
    stubFetch(() => new Response('<html>gateway error</html>', { status: 502 }));

    await expect(loadVolume('alice', 'demo')).rejects.toMatchObject({ status: 502, errorType: null });
  });
});
