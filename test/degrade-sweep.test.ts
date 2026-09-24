import { describe, expect, it } from 'vitest';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { DiscussionDAO, ProjectDAO, SnippetDAO, WikiDAO } from '@duradav/backend-data/dao';
import { RepoVisibilityService } from '@duradav/backend-services/repo/RepoVisibilityService';
import { DiscussionService } from '@duradav/backend-services/discussion';
import { RepoService } from '@duradav/backend-services/repo';

// Degrade sweep (Slice 5): DAO read fallbacks (`.catch(() => ...)` closures)
// only execute when D1 fails — happy-path fakes never reach them. One
// rejecting DB per DAO covers dozens at once; strict writes assert rejection.

function rejectingDb(): D1Queryable {
  // 'D1 down' is deliberately non-retryable (see D1ErrorClassifier), so
  // `withRetry` throws immediately without backoff sleeps.
  const boom = (): Promise<never> => Promise.reject(new Error('D1 down'));
  return {
    prepare: () => ({ bind: (..._params: unknown[]) => ({ first: boom, all: boom, run: boom }) }),
  } as unknown as D1Queryable;
}

describe('slice5: DiscussionDAO degrade', () => {
  it('falls back on reads, rejects on strict writes', async () => {
    const dao = new DiscussionDAO(rejectingDb());
    await expect(dao.nextNumber('r')).resolves.toBe(1);
    await expect(dao.listCategories('r')).resolves.toEqual([]);
    await expect(dao.getCategoryBySlug('r', 's')).resolves.toBe(null);
    await expect(dao.getCategoryById('i', 'r')).resolves.toBe(null);
    await expect(dao.ensureDefaultCategories('r', 1)).resolves.toEqual([]);
    await expect(dao.listByRepo('r')).resolves.toEqual([]);
    await expect(dao.listByRepo('r', 'c1')).resolves.toEqual([]);
    await expect(dao.getByNumber('r', 1)).resolves.toBe(null);
    await expect(dao.getById('i')).resolves.toBe(null);
    await expect(dao.countByRepo('r')).resolves.toBe(0);
    await expect(dao.listComments('d')).resolves.toEqual([]);
    await expect(dao.getComment('c', 'd')).resolves.toBe(null);
    await expect(dao.deleteByRepo('r')).resolves.toBeUndefined();
    await expect(dao.setStatus('i', 'open', 1)).rejects.toThrow();
    await expect(dao.updateDiscussion('i', { title: 't' }, 1)).rejects.toThrow();
    await expect(dao.deleteDiscussion('i')).rejects.toThrow();
    await expect(dao.createComment({ id: 'c', discussionId: 'd', authorEmail: 'a@x.com', body: 'hi', now: 1 })).rejects.toThrow();
    await expect(dao.updateComment('c', 'd', 'hi', 1)).rejects.toThrow();
    await expect(dao.deleteComment('c', 'd')).rejects.toThrow();
  });
});

describe('slice5: ProjectDAO degrade', () => {
  it('falls back on reads, rejects on strict writes', async () => {
    const dao = new ProjectDAO(rejectingDb());
    await expect(dao.nextNumber('r')).resolves.toBe(1);
    await expect(dao.listByRepo('r')).resolves.toEqual([]);
    await expect(dao.getByNumber('r', 1)).resolves.toBe(null);
    await expect(dao.getById('i', 'r')).resolves.toBe(null);
    await expect(dao.countByRepo('r')).resolves.toBe(0);
    await expect(dao.listColumns('p')).resolves.toEqual([]);
    await expect(dao.getColumn('c', 'p')).resolves.toBe(null);
    await expect(dao.listCards('p')).resolves.toEqual([]);
    await expect(dao.listCards('p', true)).resolves.toEqual([]);
    await expect(dao.getCard('c', 'p')).resolves.toBe(null);
    await expect(dao.countCardsInColumn('c')).resolves.toBe(0);
    await expect(dao.deleteByRepo('r')).resolves.toBeUndefined();
    await expect(dao.setStatus('i', 'r', 'open', 1)).rejects.toThrow();
    await expect(dao.updateProject('i', 'r', { title: 't' }, 1)).rejects.toThrow();
    await expect(dao.deleteProject('i', 'r')).rejects.toThrow();
    await expect(dao.createColumn({ id: 'c', projectId: 'p', title: 't', position: 0, now: 1 })).rejects.toThrow();
    await expect(dao.renameColumn('c', 'p', 't')).rejects.toThrow();
    await expect(dao.deleteColumn('c', 'p')).rejects.toThrow();
    await expect(dao.moveCard('c', 'p', 't', 0, 1)).rejects.toThrow();
    await expect(dao.setCardArchived('c', 'p', true, 1)).rejects.toThrow();
    await expect(dao.deleteCard('c', 'p')).rejects.toThrow();
  });
});

describe('slice5: WikiDAO degrade', () => {
  it('falls back on reads, rejects on strict writes', async () => {
    const dao = new WikiDAO(rejectingDb());
    await expect(dao.listByRepo('r')).resolves.toEqual([]);
    await expect(dao.getBySlug('r', 'home')).resolves.toBe(null);
    await expect(dao.countByRepo('r')).resolves.toBe(0);
    await expect(dao.listRevisions('p')).resolves.toEqual([]);
    await expect(dao.searchByRepo('r', 'term', 10)).resolves.toEqual([]);
    await expect(dao.deleteByRepo('r')).resolves.toBeUndefined();
    await expect(
      dao.createPage({ id: 'p', repositoryId: 'r', slug: 'home', title: 'Home', body: null, updatedBy: 'a@x.com', now: 1 }),
    ).rejects.toThrow();
    await expect(dao.updatePage('p', 'r', { body: 'x' }, 1)).rejects.toThrow();
    await expect(dao.deletePage('p', 'r')).rejects.toThrow();
  });
});

describe('slice5: SnippetDAO degrade', () => {
  it('falls back on reads, rejects on strict writes', async () => {
    const dao = new SnippetDAO(rejectingDb());
    await expect(dao.getById('s')).resolves.toBe(null);
    await expect(dao.listByOwner('a@x.com', true)).resolves.toEqual([]);
    await expect(dao.listPublic(10)).resolves.toEqual([]);
    await expect(dao.countByOwner('a@x.com')).resolves.toBe(0);
    await expect(dao.listFiles('s')).resolves.toEqual([]);
    await expect(dao.searchPublic('term', 10)).resolves.toEqual([]);
    await expect(dao.createSnippet({ id: 's', ownerEmail: 'a@x.com', title: 't', visibility: 'public', now: 1 })).rejects.toThrow();
    await expect(dao.addFile({ id: 'f', snippetId: 's', filename: 'a.txt', body: 'hi', now: 1 })).rejects.toThrow();
    await expect(dao.updateSnippet('s', { title: 't' }, 1)).rejects.toThrow();
    await expect(dao.replaceFiles('s', [{ filename: 'a.txt', body: 'hi' }], 1)).rejects.toThrow();
    await expect(dao.deleteSnippet('s')).rejects.toThrow();
  });
});

describe('slice5: RepoVisibilityService degrade', () => {
  function service() {
    const db = rejectingDb();
    return new RepoVisibilityService({
      repositoryDAO: async () => new (await import('@duradav/backend-data/dao').then((m) => m.RepositoryDAO))(db),
      organizationDAO: async () => new (await import('@duradav/backend-data/dao').then((m) => m.OrganizationDAO))(db),
      organizationMemberDAO: async () => new (await import('@duradav/backend-data/dao').then((m) => m.OrganizationMemberDAO))(db),
      repoCollaboratorDAO: async () => new (await import('@duradav/backend-data/dao').then((m) => m.RepoCollaboratorDAO))(db),
      permissionService: async () =>
        new (await import('@duradav/backend-services/permission').then((m) => m.PermissionService))({ DB: db }),
    });
  }

  it('resolves empty visibility without throwing', async () => {
    const svc = service();
    await expect(svc.listVisibleForUser('a@x.com', async () => null)).resolves.toEqual([]);
    await expect(svc.listVisibleForUser('a@x.com', async () => 'alice')).resolves.toEqual([]);
    await expect(svc.listVisibleForUser('a@x.com', async () => Promise.reject(new Error('lookup failed')))).resolves.toEqual([]);
  });

  it('rejects role checks when persistence is gone', async () => {
    const svc = service();
    await expect(svc.getRole('a@x.com', null)).resolves.toBe(null);
    await expect(svc.requireRole('alice', 'demo', 'a@x.com', 'read')).rejects.toThrow();
  });
});

describe('slice5: DiscussionService UNIQUE retry', () => {
  it('retries once on a numbering collision then succeeds', async () => {
    let creates = 0;
    const row = {
      id: 'd1',
      repository_id: 'r',
      category_id: null,
      number: 2,
      title: 't',
      body: null,
      author_email: 'a@x.com',
      created_at: 1,
      updated_at: 1,
    };
    const dao = {
      countByRepo: async () => 0,
      nextNumber: async () => 1,
      createDiscussion: async () => {
        creates += 1;
        if (creates === 1) throw new Error('UNIQUE constraint failed: discussions.repository_id, discussions.number');
      },
      getByNumber: async () => row,
    };
    const svc = new DiscussionService({ DB: {} as never }, { discussionDAO: async () => dao as never });
    const out = await svc.createDiscussion('r', { title: 't' }, 'A@X.COM');
    expect(creates).toBe(2);
    expect(out.number).toBe(2);
  });
});

describe('slice5: RepoService role delegation', () => {
  it('delegates getRole without touching D1 for null repos', async () => {
    const svc = new RepoService({ DB: rejectingDb() } as never);
    await expect(svc.getRole(null, null)).resolves.toBe(null);
  });
});
