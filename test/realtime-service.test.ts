import { describe, expect, it } from 'vitest';
import { Tokens, createRequestScope } from '@duradav/backend-services/composition';
import { RealtimeService } from '@duradav/backend-services/realtime';

function makeService(
  opts: {
    repo?: { id: string; owner: string; name: string; is_private: number } | null;
    role?: string | null;
  } = {},
) {
  return new RealtimeService(
    { DB: {} as never },
    {
      repositoryDAO: async () =>
        ({
          getByOwnerAndName: async () => opts.repo ?? null,
        }) as never,
      permissionService: async () =>
        ({
          getRole: async () => opts.role ?? null,
        }) as never,
    },
  );
}

describe('RealtimeService repo authorization', () => {
  const publicRepo = { id: 'r1', owner: 'Alice', name: 'Demo', is_private: 0 };

  it('authorizes read+ viewers with their requested channels', async () => {
    const svc = makeService({ repo: publicRepo, role: 'read' });
    const grant = await svc.authorizeRepoChannels({
      viewerEmail: 'v@example.com',
      owner: 'alice',
      repo: 'demo',
      channels: ['issue:3', 'activity', 'bogus'],
    });
    expect(grant).toMatchObject({
      shard: 'repo:alice/demo',
      channels: ['issue:3', 'activity'],
      repositoryId: 'r1',
      fullName: 'Alice/Demo',
    });
  });

  it('admits anonymous viewers on public repos', async () => {
    const svc = makeService({ repo: publicRepo, role: 'read' });
    const grant = await svc.authorizeRepoChannels({ viewerEmail: null, owner: 'alice', repo: 'demo', channels: ['activity'] });
    expect(grant.shard).toBe('repo:alice/demo');
  });

  it('hides private repos without a role (404, not 403)', async () => {
    const svc = makeService({ repo: { ...publicRepo, is_private: 1 }, role: null });
    const error = await svc
      .authorizeRepoChannels({ viewerEmail: 's@example.com', owner: 'alice', repo: 'demo', channels: ['activity'] })
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Repository not found.');
    expect((error as { getErrorCode?: () => number }).getErrorCode?.()).toBe(404);
  });

  it('returns 404 for unknown repos', async () => {
    const svc = makeService({ repo: null, role: 'read' });
    await expect(
      svc.authorizeRepoChannels({ viewerEmail: 'v@example.com', owner: 'alice', repo: 'nope', channels: ['activity'] }),
    ).rejects.toThrow('Repository not found.');
  });

  it('rejects empty and inbox-only channel requests', async () => {
    const svc = makeService({ repo: publicRepo, role: 'read' });
    await expect(svc.authorizeRepoChannels({ viewerEmail: 'v@example.com', owner: 'alice', repo: 'demo', channels: [] })).rejects.toThrow(
      'No subscribable channels',
    );
    await expect(
      svc.authorizeRepoChannels({ viewerEmail: 'v@example.com', owner: 'alice', repo: 'demo', channels: ['inbox:0123456789abcdef'] }),
    ).rejects.toThrow('No subscribable channels');
  });
});

describe('RealtimeService inbox helpers', () => {
  it('hashes emails deterministically and normalizes recipient hashes', async () => {
    const first = await RealtimeService.inboxHashForEmail('V@Example.COM');
    expect(first).toBe(await RealtimeService.inboxHashForEmail('v@example.com'));
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(RealtimeService.normalizeRecipientHashes([first, first, 'bogus'])).toEqual([first]);
    expect(RealtimeService.normalizeRecipientHashes(null)).toEqual([]);
  });

  it('hashes recipient batches for inbox fan-out', async () => {
    const hashes = await RealtimeService.hashRecipients(['a@example.com', 'b@example.com']);
    expect(hashes).toHaveLength(2);
    expect(new Set(hashes).size).toBe(2);
  });

  it('grants self-only inbox subscriptions', () => {
    const svc = makeService();
    const grant = svc.inboxSubscription('0123456789abcdef');
    expect(grant).toEqual({ shard: 'inbox:global', channels: ['inbox:0123456789abcdef'] });
    expect(() => svc.inboxSubscription('bogus')).toThrow();
  });
});

describe('realtime composition', () => {
  it('binds RealtimeService in a request scope', () => {
    const scope = createRequestScope({ DB: {} } as never);
    expect(scope.get(Tokens.RealtimeService)).toBeInstanceOf(RealtimeService);
  });
});
