import { describe, expect, it } from 'vitest';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { EventDAO } from '@duradav/backend-data/dao/EventDAO';
import { NotificationDAO } from '@duradav/backend-data/dao/NotificationDAO';
import { StarDAO } from '@duradav/backend-data/dao/StarDAO';
import { WatchDAO } from '@duradav/backend-data/dao/WatchDAO';
import { Tokens, createRequestScope } from '@duradav/backend-services/composition';
import { ActivityService } from '@duradav/backend-services/social/ActivityService';
import { NotificationService } from '@duradav/backend-services/social/NotificationService';
import { StarService } from '@duradav/backend-services/social/StarService';
import { WatchService } from '@duradav/backend-services/social/WatchService';

interface FakeState {
  stars: Array<{ repo_id: string; user_email: string; created_at: number }>;
  watches: Array<{ repo_id: string; user_email: string; created_at: number }>;
  events: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
}

function createSocialFakeDb(): D1Queryable & { state: FakeState } {
  const state: FakeState = { stars: [], watches: [], events: [], notifications: [] };
  const db = {
    state,
    prepare(query: string) {
      const q = query.replace(/\s+/g, ' ').trim();
      let params: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          params = args;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (q.startsWith('SELECT repo_id FROM repo_stars WHERE repo_id = ? AND user_email = ?')) {
            const row = state.stars.find((s) => s.repo_id === params[0] && s.user_email === params[1]);
            return (row ? { repo_id: row.repo_id } : null) as T | null;
          }
          if (q.startsWith('SELECT COUNT(*) AS n FROM repo_stars WHERE repo_id = ?')) {
            return { n: state.stars.filter((s) => s.repo_id === params[0]).length } as unknown as T;
          }
          if (q.startsWith('SELECT repo_id FROM repo_watches WHERE repo_id = ? AND user_email = ?')) {
            const row = state.watches.find((s) => s.repo_id === params[0] && s.user_email === params[1]);
            return (row ? { repo_id: row.repo_id } : null) as T | null;
          }
          if (q.startsWith('SELECT COUNT(*) AS n FROM repo_watches WHERE repo_id = ?')) {
            return { n: state.watches.filter((s) => s.repo_id === params[0]).length } as unknown as T;
          }
          if (q.startsWith('SELECT COUNT(*) AS n FROM notifications WHERE user_email = ? AND is_read = 0')) {
            return { n: state.notifications.filter((n) => n.user_email === params[0] && n.is_read === 0).length } as unknown as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (q.startsWith('SELECT repo_id FROM repo_stars WHERE user_email = ?')) {
            const rows = state.stars.filter((s) => s.user_email === params[0]).slice(0, params[1] as number);
            return { results: rows as unknown as T[] };
          }
          if (q.startsWith('SELECT user_email FROM repo_watches WHERE repo_id = ?')) {
            const rows = state.watches.filter((s) => s.repo_id === params[0]).slice(0, params[1] as number);
            return { results: rows as unknown as T[] };
          }
          if (q.startsWith('SELECT repo_id FROM repo_watches WHERE user_email = ?')) {
            const rows = state.watches.filter((s) => s.user_email === params[0]).slice(0, params[1] as number);
            return { results: rows as unknown as T[] };
          }
          if (q.includes('FROM repo_events WHERE repository_id = ?')) {
            let rows = state.events.filter((e) => e.repository_id === params[0]);
            rows = [...rows].sort(
              (a, b) => (b.created_at as number) - (a.created_at as number) || String(b.id).localeCompare(String(a.id)),
            );
            if (params.length === 5) {
              const [, cutoff, cutoffAgain, lastId, limitPlus] = params as [unknown, number, number, string, number];
              void cutoffAgain;
              rows = rows.filter(
                (e) => (e.created_at as number) < cutoff || ((e.created_at as number) === cutoff && String(e.id) < lastId),
              );
              return { results: rows.slice(0, limitPlus as number) as unknown as T[] };
            }
            return { results: rows.slice(0, params[1] as number) as unknown as T[] };
          }
          if (q.includes('FROM notifications WHERE user_email = ?')) {
            const unreadOnly = q.includes('AND is_read = 0');
            let rows = state.notifications.filter((n) => n.user_email === params[0] && (!unreadOnly || n.is_read === 0));
            rows = [...rows].sort(
              (a, b) => (b.created_at as number) - (a.created_at as number) || String(b.id).localeCompare(String(a.id)),
            );
            if (params.length === 5) {
              const [, cutoff, cutoffAgain, lastId, limitPlus] = params as [unknown, number, number, string, number];
              void cutoffAgain;
              rows = rows.filter(
                (n) => (n.created_at as number) < cutoff || ((n.created_at as number) === cutoff && String(n.id) < lastId),
              );
              return { results: rows.slice(0, limitPlus as number) as unknown as T[] };
            }
            return { results: rows.slice(0, params[1] as number) as unknown as T[] };
          }
          return { results: [] };
        },
        async run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
          if (q.startsWith('INSERT OR IGNORE INTO repo_stars')) {
            const [repo_id, user_email, created_at] = params as [string, string, number];
            if (!state.stars.some((s) => s.repo_id === repo_id && s.user_email === user_email)) {
              state.stars.push({ repo_id, user_email, created_at });
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (q.startsWith('DELETE FROM repo_stars WHERE repo_id = ? AND user_email = ?')) {
            const before = state.stars.length;
            state.stars = state.stars.filter((s) => !(s.repo_id === params[0] && s.user_email === params[1]));
            return { success: true, meta: { changes: before - state.stars.length } };
          }
          if (q === 'DELETE FROM repo_stars WHERE repo_id = ?') {
            const before = state.stars.length;
            state.stars = state.stars.filter((s) => s.repo_id !== params[0]);
            return { success: true, meta: { changes: before - state.stars.length } };
          }
          if (q.startsWith('INSERT OR IGNORE INTO repo_watches')) {
            const [repo_id, user_email, created_at] = params as [string, string, number];
            if (!state.watches.some((s) => s.repo_id === repo_id && s.user_email === user_email)) {
              state.watches.push({ repo_id, user_email, created_at });
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (q.startsWith('DELETE FROM repo_watches WHERE repo_id = ? AND user_email = ?')) {
            const before = state.watches.length;
            state.watches = state.watches.filter((s) => !(s.repo_id === params[0] && s.user_email === params[1]));
            return { success: true, meta: { changes: before - state.watches.length } };
          }
          if (q === 'DELETE FROM repo_watches WHERE repo_id = ?') {
            const before = state.watches.length;
            state.watches = state.watches.filter((s) => s.repo_id !== params[0]);
            return { success: true, meta: { changes: before - state.watches.length } };
          }
          if (q.startsWith('INSERT INTO repo_events')) {
            const [id, repository_id, actor_email, type, subject_type, subject_number, subject_oid, payload, created_at] =
              params as Array<string | number | null>;
            state.events.push({
              id,
              repository_id,
              actor_email,
              type,
              subject_type,
              subject_number,
              subject_oid,
              payload,
              created_at,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (q.startsWith('DELETE FROM repo_events WHERE repository_id = ?')) {
            const before = state.events.length;
            state.events = state.events.filter((e) => e.repository_id !== params[0]);
            return { success: true, meta: { changes: before - state.events.length } };
          }
          if (q.includes('DELETE FROM repo_events') && q.includes('SELECT id FROM repo_events')) {
            const [cutoff, limit] = params as [number, number];
            const victims = state.events.filter((e) => (e.created_at as number) < cutoff).slice(0, limit);
            const ids = new Set(victims.map((v) => v.id));
            state.events = state.events.filter((e) => !ids.has(e.id));
            return { success: true, meta: { changes: victims.length } };
          }
          if (q.startsWith('INSERT OR IGNORE INTO notifications')) {
            const [id, user_email, repository_id, actor_email, type, title, subject_type, subject_number, created_at] =
              params as Array<string | number | null>;
            if (!state.notifications.some((n) => n.id === id)) {
              state.notifications.push({
                id,
                user_email,
                repository_id,
                actor_email,
                type,
                title,
                subject_type,
                subject_number,
                is_read: 0,
                created_at,
              });
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (q.startsWith('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_email = ?')) {
            const row = state.notifications.find((n) => n.id === params[0] && n.user_email === params[1]);
            if (row && row.is_read === 0) {
              row.is_read = 1;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (q.startsWith('UPDATE notifications SET is_read = 1 WHERE user_email = ? AND is_read = 0')) {
            let changed = 0;
            for (const n of state.notifications) {
              if (n.user_email === params[0] && n.is_read === 0) {
                n.is_read = 1;
                changed += 1;
              }
            }
            return { success: true, meta: { changes: changed } };
          }
          if (q.includes('DELETE FROM notifications WHERE id IN')) {
            const [cutoff, limit] = params as [number, number];
            const victims = state.notifications.filter((n) => n.is_read === 1 && (n.created_at as number) < cutoff).slice(0, limit);
            const ids = new Set(victims.map((v) => v.id));
            state.notifications = state.notifications.filter((n) => !ids.has(n.id));
            return { success: true, meta: { changes: victims.length } };
          }
          if (q.startsWith('DELETE FROM notifications WHERE repository_id = ?')) {
            const before = state.notifications.length;
            state.notifications = state.notifications.filter((n) => n.repository_id !== params[0]);
            return { success: true, meta: { changes: before - state.notifications.length } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  return db as unknown as D1Queryable & { state: FakeState };
}

describe('StarDAO', () => {
  it('stars idempotently, counts, and unstars', async () => {
    const db = createSocialFakeDb();
    const dao = new StarDAO(db);
    await dao.star('r1', 'a@example.com', 100);
    await dao.star('r1', 'a@example.com', 101);
    await dao.star('r1', 'b@example.com', 102);
    expect(await dao.countByRepo('r1')).toBe(2);
    expect(await dao.isStarred('r1', 'a@example.com')).toBe(true);
    expect(await dao.listRepoIdsByUser('a@example.com')).toEqual(['r1']);
    await dao.unstar('r1', 'a@example.com');
    expect(await dao.isStarred('r1', 'a@example.com')).toBe(false);
    expect(await dao.countByRepo('r1')).toBe(1);
  });
});

describe('WatchDAO', () => {
  it('watches idempotently and lists watchers', async () => {
    const db = createSocialFakeDb();
    const dao = new WatchDAO(db);
    await dao.watch('r1', 'a@example.com', 100);
    await dao.watch('r1', 'a@example.com', 101);
    await dao.watch('r1', 'b@example.com', 102);
    expect(await dao.countByRepo('r1')).toBe(2);
    expect(await dao.listWatchers('r1', 500)).toEqual(expect.arrayContaining(['a@example.com', 'b@example.com']));
    await dao.unwatch('r1', 'a@example.com');
    expect(await dao.isWatching('r1', 'a@example.com')).toBe(false);
  });
});

describe('EventDAO', () => {
  it('appends and paginates newest-first with cursor', async () => {
    const db = createSocialFakeDb();
    const dao = new EventDAO(db);
    for (let i = 1; i <= 3; i += 1) {
      await dao.append({
        id: `e${i}`,
        repositoryId: 'r1',
        fullName: 'o/r',
        actorEmail: 'a@example.com',
        type: 'issue_opened',
        subjectType: 'issue',
        subjectNumber: i,
        now: 100 + i,
      });
    }
    const first = await dao.listByRepo('r1', 2);
    expect(first.events.map((e) => e.id)).toEqual(['e3', 'e2']);
    expect(first.nextCursor).not.toBeNull();
    const second = await dao.listByRepo('r1', 2, first.nextCursor ?? undefined);
    expect(second.events.map((e) => e.id)).toEqual(['e1']);
    expect(second.nextCursor).toBeNull();
  });

  it('prunes events older than cutoff', async () => {
    const db = createSocialFakeDb();
    const dao = new EventDAO(db);
    await dao.append({ id: 'old', repositoryId: 'r1', fullName: 'o/r', actorEmail: 'a@example.com', type: 'push', now: 10 });
    await dao.append({ id: 'new', repositoryId: 'r1', fullName: 'o/r', actorEmail: 'a@example.com', type: 'push', now: 1000 });
    expect(await dao.pruneOlderThan(100, 100)).toBe(1);
    expect(db.state.events.map((e) => e.id)).toEqual(['new']);
  });
});

describe('NotificationDAO', () => {
  it('inserts, lists unread-first, and marks read', async () => {
    const db = createSocialFakeDb();
    const dao = new NotificationDAO(db);
    await dao.insert({
      id: 'n1',
      userEmail: 'a@example.com',
      repositoryId: 'r1',
      fullName: 'o/r',
      actorEmail: 'b@example.com',
      type: 'issue_opened',
      title: 'Bug',
      now: 100,
    });
    await dao.insert({
      id: 'n2',
      userEmail: 'a@example.com',
      repositoryId: 'r1',
      fullName: 'o/r',
      actorEmail: 'b@example.com',
      type: 'push',
      title: 'Push',
      now: 200,
    });
    expect(await dao.unreadCount('a@example.com')).toBe(2);
    const unread = await dao.listByUser('a@example.com', 50, undefined, true);
    expect(unread.notifications.map((n) => n.id)).toEqual(['n2', 'n1']);
    expect(await dao.markRead('n2', 'a@example.com')).toBe(true);
    expect(await dao.markRead('n2', 'other@example.com')).toBe(false);
    expect(await dao.unreadCount('a@example.com')).toBe(1);
    expect(await dao.markAllRead('a@example.com')).toBe(1);
    expect(await dao.unreadCount('a@example.com')).toBe(0);
  });

  it('prunes only read notifications older than cutoff', async () => {
    const db = createSocialFakeDb();
    const dao = new NotificationDAO(db);
    await dao.insert({
      id: 'read-old',
      userEmail: 'a@example.com',
      repositoryId: 'r1',
      fullName: 'o/r',
      actorEmail: 'b@example.com',
      type: 'push',
      title: 'Old',
      now: 10,
    });
    await dao.insert({
      id: 'unread-old',
      userEmail: 'a@example.com',
      repositoryId: 'r1',
      fullName: 'o/r',
      actorEmail: 'b@example.com',
      type: 'push',
      title: 'Unread',
      now: 10,
    });
    await dao.markRead('read-old', 'a@example.com');
    expect(await dao.pruneReadOlderThan(100, 100)).toBe(1);
    expect(db.state.notifications.map((n) => n.id)).toEqual(['unread-old']);
  });
});

describe('social services', () => {
  it('StarService lowercases emails and delegates', async () => {
    const calls: string[] = [];
    const svc = new StarService(
      { DB: {} as never },
      { starDAO: async () => ({ star: async (r: string, e: string) => void calls.push(`${r}:${e}`) }) as never },
    );
    await svc.star('r1', 'A@Example.COM');
    expect(calls).toEqual(['r1:a@example.com']);
  });

  it('WatchService ensureWatching delegates to watch', async () => {
    let watched = 0;
    const svc = new WatchService({ DB: {} as never }, { watchDAO: async () => ({ watch: async () => void (watched += 1) }) as never });
    await svc.ensureWatching('r1', 'a@example.com');
    expect(watched).toBe(1);
  });

  it('ActivityService records with generated id and lists', async () => {
    const appended: Array<Record<string, unknown>> = [];
    const svc = new ActivityService(
      { DB: {} as never },
      {
        eventDAO: async () =>
          ({
            append: async (input: Record<string, unknown>) => void appended.push(input),
            listByRepo: async () => ({ events: [], nextCursor: null }),
          }) as never,
      },
    );
    const { id } = await svc.record({ repositoryId: 'r1', fullName: 'o/r', actorEmail: 'A@Example.COM', type: 'push' });
    expect(typeof id).toBe('string');
    expect(appended[0].actorEmail).toBe('a@example.com');
    expect(appended[0].payload).toBe('{}');
  });

  it('NotificationService parses @mentions case-insensitively without duplicates', () => {
    expect(NotificationService.parseMentions('cc @Alice and @alice plus @bob-smith!')).toEqual(['alice', 'bob-smith']);
    expect(NotificationService.parseMentions(null)).toEqual([]);
  });

  it('fanOut notifies watchers and mentions but skips actor and no-access users', async () => {
    const inserted: string[] = [];
    const svc = new NotificationService(
      { DB: {} as never },
      {
        notificationDAO: async () => ({ insert: async (input: { userEmail: string }) => void inserted.push(input.userEmail) }) as never,
        watchDAO: async () => ({ listWatchers: async () => ['Watcher@Example.COM', 'actor@example.com'] }) as never,
        userDAO: async () =>
          ({ getByUsernameCi: async (u: string) => (u === 'mentioned' ? { email: 'Mentioned@Example.COM' } : null) }) as never,
        repositoryDAO: async () => ({ getById: async () => ({ id: 'r1', owner: 'o', name: 'r', is_private: 0 }) }) as never,
        permissionService: async () =>
          ({
            getRole: async (email: string) => (email === 'watcher@example.com' || email === 'mentioned@example.com' ? 'read' : null),
          }) as never,
      },
    );
    const result = await svc.fanOut({
      repositoryId: 'r1',
      fullName: 'o/r',
      actorEmail: 'actor@example.com',
      type: 'issue_opened',
      title: 'Hello',
      participantEmails: ['creator@example.com'],
      mentionUsernames: ['mentioned'],
    });
    // creator has no role → skipped; watcher + mentioned notified; actor excluded.
    expect(inserted.sort()).toEqual(['mentioned@example.com', 'watcher@example.com']);
    expect(result).toEqual({ notified: 2, recipients: ['watcher@example.com', 'mentioned@example.com'] });
  });
});

describe('social composition', () => {
  it('binds social tokens in a request scope', () => {
    const scope = createRequestScope({ DB: {} } as never);
    expect(scope.has(Tokens.StarDAO)).toBe(true);
    expect(scope.has(Tokens.WatchDAO)).toBe(true);
    expect(scope.has(Tokens.EventDAO)).toBe(true);
    expect(scope.has(Tokens.NotificationDAO)).toBe(true);
    expect(scope.get(Tokens.StarService)).toBeInstanceOf(StarService);
    expect(scope.get(Tokens.WatchService)).toBeInstanceOf(WatchService);
    expect(scope.get(Tokens.ActivityService)).toBeInstanceOf(ActivityService);
    expect(scope.get(Tokens.NotificationService)).toBeInstanceOf(NotificationService);
  });
});
