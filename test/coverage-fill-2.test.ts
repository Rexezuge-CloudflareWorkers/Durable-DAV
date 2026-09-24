import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KvCache } from '@duradav/backend-runtime/kv';
import type { KvNamespaceLike } from '@duradav/backend-runtime/kv';
import { createLogger } from '@duradav/backend-runtime/logger';
import { BaseScheduledTask } from '@duradav/background/scheduled/IScheduledTask';
import { StarService } from '@duradav/backend-services/social/StarService';
import { WatchService } from '@duradav/backend-services/social/WatchService';
import { NotificationService } from '@duradav/backend-services/social/NotificationService';

function makeMemoryKv(): KvNamespaceLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => Promise.resolve(store.delete(key)),
    list: (options: { prefix: string }) => {
      const keys = [...store.keys()].filter((name) => name.startsWith(options.prefix)).map((name) => ({ name }));
      return Promise.resolve({ keys, list_complete: true });
    },
  };
}

class ProbeTask extends BaseScheduledTask {
  public readonly name = 'ProbeTask';
  public readonly phase: 1 | 2 = 1;
  public calls: string[] = [];
  public constructor(private readonly fail: boolean = false) {
    super();
  }

  protected handleScheduledTask(): Promise<void> {
    this.calls.push('handled');
    if (this.fail) throw new Error('task-boom');
    return Promise.resolve();
  }
}

describe('cache helpers', () => {
  it('builds namespaced keys and round-trips through the single binding', async () => {
    const kv = makeMemoryKv();
    const cache = new KvCache(kv);
    expect(cache.keyFor('refs', ['alice/demo', 'abc'])).toBe('refs:v1:alice%2Fdemo:abc');
    await expect(cache.putJson('refs', ['k1'], { n: 1 })).resolves.toBe(true);
    await expect(cache.getJson<{ n: number }>('refs', ['k1'])).resolves.toEqual({ n: 1 });
    await expect(cache.getJson('refs', ['missing'])).resolves.toBeNull();
  });

  it('isolates purge by domain prefix', async () => {
    const kv = makeMemoryKv();
    const cache = new KvCache(kv);
    await cache.putText('refs', ['a'], 'x');
    await cache.putText('jwks', ['a'], 'y');
    await expect(cache.purgePrefix('refs')).resolves.toBe(1);
    await expect(cache.getText('jwks', ['a'])).resolves.toBe('y');
  });
});

describe('scheduled task template', () => {
  it('logs and delegates, propagating failures', async () => {
    const ok = new ProbeTask(false);
    await expect(ok.run({} as Env)).resolves.toBeUndefined();
    expect(ok.calls).toEqual(['handled']);
    const failing = new ProbeTask(true);
    await expect(failing.run({} as Env)).rejects.toThrow('task-boom');
  });
});

describe('social thin services', () => {
  it('StarService delegates with lowercased email', async () => {
    const calls: string[] = [];
    const fakeDao = {
      star: async (repo: string, email: string) => {
        calls.push(`star:${repo}:${email}`);
      },
      unstar: async (repo: string, email: string) => {
        calls.push(`unstar:${repo}:${email}`);
      },
      isStarred: async () => true,
      countByRepo: async () => 3,
      listRepoIdsByUser: async () => ['r1'],
    };
    const svc = new StarService({ DB: null as never }, { starDAO: async () => fakeDao as never });
    await svc.star('r1', 'A@X.com');
    await svc.unstar('r1', 'A@X.com');
    await expect(svc.isStarred('r1', 'a@x.com')).resolves.toBe(true);
    await expect(svc.countByRepo('r1')).resolves.toBe(3);
    await expect(svc.listRepoIdsByUser('A@X.com')).resolves.toEqual(['r1']);
    expect(calls).toEqual(['star:r1:a@x.com', 'unstar:r1:a@x.com']);
  });

  it('WatchService delegates including ensureWatching', async () => {
    const calls: string[] = [];
    const fakeDao = {
      watch: async (repo: string, email: string) => {
        calls.push(`watch:${repo}:${email}`);
      },
      unwatch: async () => undefined,
      isWatching: async () => false,
      countByRepo: async () => 0,
      listWatchers: async () => ['a@x.com'],
      listRepoIdsByUser: async () => [],
    };
    const svc = new WatchService({ DB: null as never }, { watchDAO: async () => fakeDao as never });
    await svc.watch('r1', 'B@Y.com');
    await svc.ensureWatching('r1', 'B@Y.com');
    await svc.unwatch('r1', 'b@y.com');
    await expect(svc.isWatching('r1', 'b@y.com')).resolves.toBe(false);
    await expect(svc.countByRepo('r1')).resolves.toBe(0);
    await expect(svc.listWatchers('r1')).resolves.toEqual(['a@x.com']);
    expect(calls).toEqual(['watch:r1:b@y.com', 'watch:r1:b@y.com']);
  });

  it('NotificationService marks read via fake DAO', async () => {
    const fakeDao = {
      markRead: async () => true,
      markAllRead: async () => 2,
      unreadCount: async () => 1,
      listByUser: async () => ({ notifications: [{ id: 'n1' }], nextCursor: null }),
      pruneReadOlderThan: async () => 0,
    };
    const svc = new NotificationService({ DB: null as never }, { notificationDAO: async () => fakeDao as never });
    await expect(svc.markRead('n1', 'a@x.com')).resolves.toBe(true);
    await expect(svc.markAllRead('a@x.com')).resolves.toBe(2);
    await expect(svc.unreadCount('a@x.com')).resolves.toBe(1);
    await expect(svc.listByUser('a@x.com')).resolves.toMatchObject({ nextCursor: null });
    await expect(svc.pruneReadOlderThan(1, 10)).resolves.toBe(0);
  });
});

describe('logger levels', () => {
  it('emits at or above the configured level', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const log = createLogger('TestScope');
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');
      expect(infoSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(debugSpy).not.toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
