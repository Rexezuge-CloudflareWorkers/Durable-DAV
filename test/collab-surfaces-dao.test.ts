import { describe, expect, it } from 'vitest';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { DiscussionDAO } from '@duradav/backend-data/dao/DiscussionDAO';
import { ProjectDAO } from '@duradav/backend-data/dao/ProjectDAO';
import { SearchDAO } from '@duradav/backend-data/dao/SearchDAO';
import { SnippetDAO } from '@duradav/backend-data/dao/SnippetDAO';
import { WikiDAO } from '@duradav/backend-data/dao/WikiDAO';
import { DiscussionService } from '@duradav/backend-services/discussion';
import { ProjectService } from '@duradav/backend-services/project';
import { SnippetService } from '@duradav/backend-services/snippet';
import { WikiService } from '@duradav/backend-services/wiki';

// Generic in-memory D1 fake for the collab-surfaces tables. Handles the
// flat SQL shapes these DAOs use: INSERT (incl. OR IGNORE + UNIQUE checks),
// SELECT with equality/LIKE filters + ORDER BY + LIMIT, UPDATE … SET … WHERE,
// DELETE … WHERE. FTS5 virtual tables (`*_fts`) throw so SearchDAO exercises
// its LIKE fallback, mirroring unit fakes without FTS5.
type Row = Record<string, unknown>;

const UNIQUES: Record<string, string[][]> = {
  projects: [['id'], ['repository_id', 'number']],
  project_columns: [['id'], ['project_id', 'title']],
  project_cards: [['id']],
  discussion_categories: [['id'], ['repository_id', 'slug']],
  discussions: [['id'], ['repository_id', 'number']],
  discussion_comments: [['id']],
  wiki_pages: [['id'], ['repository_id', 'slug']],
  wiki_revisions: [['id'], ['page_id', 'revision']],
  snippets: [['id']],
  snippet_files: [['id'], ['snippet_id', 'filename']],
};

function norm(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function likeMatch(value: unknown, pattern: unknown): boolean {
  if (typeof value !== 'string' || typeof pattern !== 'string') return false;
  const unescaped = pattern.replaceAll('!!', '!').replaceAll('!%', '%').replaceAll('!_', '_');
  const inner = unescaped.startsWith('%') && unescaped.endsWith('%') ? unescaped.slice(1, -1) : unescaped;
  return value.toLowerCase().includes(inner.toLowerCase());
}

function createFakeDb(): D1Queryable {
  const tables = new Map<string, Row[]>();
  const table = (name: string): Row[] => {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  };

  function matchesWhere(row: Row, where: string, params: unknown[]): boolean {
    // Split top-level ANDs (LIKE groups use parenthesized ORs, never ANDs).
    const conditions = where.split(' AND ');
    let index = 0;
    for (const raw of conditions) {
      let cond = raw.trim();
      if (cond.startsWith('(') && cond.endsWith(')')) cond = cond.slice(1, -1);
      if (cond.includes(' OR ')) {
        const branches = cond.split(' OR ');
        const arity = branches.map((b) => (b.match(/\?/g) ?? []).length);
        let matched = false;
        let cursor = index;
        for (let b = 0; b < branches.length; b++) {
          if (matchAtom(row, branches[b].trim(), params.slice(cursor, cursor + arity[b]))) matched = true;
          cursor += arity[b];
        }
        if (!matched) return false;
        index = cursor;
        continue;
      }
      if (!matchAtom(row, cond, params.slice(index, index + 1))) return false;
      index += (cond.match(/\?/g) ?? []).length;
    }
    return true;
  }

  function matchAtom(row: Row, cond: string, params: unknown[]): boolean {
    const lowerLike = /^lower\((?:COALESCE\((\w+), ''\)|(\w+))\) LIKE \?/i.exec(cond);
    if (lowerLike) {
      const col = lowerLike[1] ?? lowerLike[2];
      const value = row[col];
      return likeMatch(typeof value === 'string' ? value : String(value ?? ''), params[0]);
    }
    const eqParam = /^(\w+) = \?$/.exec(cond);
    if (eqParam) return row[eqParam[1]] === params[0];
    const eqLiteral = /^(\w+) = '([^']*)'$/.exec(cond);
    if (eqLiteral) return String(row[eqLiteral[1]] ?? '') === eqLiteral[2];
    const eqNumber = /^(\w+) = (\d+)$/.exec(cond);
    if (eqNumber) return Number(row[eqNumber[1]] ?? Number.NaN) === Number(eqNumber[2]);
    throw new Error(`unsupported WHERE condition: ${cond}`);
  }

  function select(query: string, params: unknown[]): Row[] {
    const q = norm(query);
    const from = /FROM (\w+)/i.exec(q);
    if (!from) throw new Error(`unsupported SELECT: ${q}`);
    if (from[1].endsWith('_fts')) throw new Error('no such table: fts');
    let rows = [...table(from[1])];
    const where = /WHERE (.+?)(?: ORDER BY | LIMIT |$)/i.exec(q);
    let limitParam: unknown;
    if (where) {
      rows = rows.filter((row) => matchesWhere(row, where[1], params));
      const used = (where[1].match(/\?/g) ?? []).length;
      limitParam = params[used];
    } else if (/LIMIT \?$/i.test(q)) {
      limitParam = params[0];
    }
    const order = /ORDER BY (.+?)(?: LIMIT |$)/i.exec(q);
    if (order) {
      const keys = order[1].split(',').map((part) => {
        const [col, dir] = part.trim().split(/\s+/);
        return { col, desc: (dir ?? 'ASC').toUpperCase() === 'DESC' };
      });
      rows.sort((a, b) => {
        for (const { col, desc } of keys) {
          const av = a[col] as number | string | null;
          const bv = b[col] as number | string | null;
          if (av !== bv) {
            if (av === null) return 1;
            if (bv === null) return -1;
            const cmp = av < bv ? -1 : 1;
            return desc ? -cmp : cmp;
          }
        }
        return 0;
      });
    }
    if (/LIMIT \?$/i.test(q) && typeof limitParam === 'number') rows = rows.slice(0, limitParam);
    return rows;
  }

  function statement(query: string, params: unknown[]) {
    const q = norm(query);
    return {
      first<T>(): Promise<T | null> {
        const count = /SELECT COUNT\(\*\) AS count/i.exec(q);
        if (count) {
          const rows = select(query, params);
          return Promise.resolve({ count: rows.length } as unknown as T);
        }
        const nextNumber = /COALESCE\(MAX\((\w+)\), 0\) \+ 1 AS (\w+)/i.exec(q);
        if (nextNumber) {
          const rows = select(query.replace(/SELECT .* FROM/i, 'SELECT * FROM'), params);
          const max = rows.reduce((m, r) => Math.max(m, Number(r[nextNumber[1]] ?? 0)), 0);
          return Promise.resolve({ [nextNumber[2]]: max + 1 } as unknown as T);
        }
        const rows = select(query, params);
        return Promise.resolve((rows[0] ?? null) as T | null);
      },
      all<T>(): Promise<{ results: T[] }> {
        return Promise.resolve({ results: select(query, params) as T[] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
        const insert = /INSERT (OR IGNORE )?INTO (\w+) \(([^)]+)\) VALUES \((.+)\)/i.exec(q);
        if (insert) {
          const [, orIgnore, name, cols, values] = insert;
          const columns = cols.split(',').map((c) => c.trim());
          const tokens = values.split(',').map((v) => v.trim());
          const row: Row = {};
          let paramIndex = 0;
          const parseLiteral = (token: string): unknown => {
            if (token === '?') {
              const value = params[paramIndex];
              paramIndex += 1;
              return value;
            }
            const quoted = /^'(.*)'$/.exec(token);
            if (quoted) return quoted[1];
            if (/^-?\d+$/.test(token)) return Number(token);
            throw new Error(`unsupported VALUES token: ${token}`);
          };
          columns.forEach((col, i) => {
            row[col] = parseLiteral(tokens[i]);
          });
          const conflicts = (UNIQUES[name] ?? []).some((key) =>
            table(name).some((existing) => key.every((col) => existing[col] === row[col])),
          );
          if (conflicts) {
            if (orIgnore) return Promise.resolve({ success: true, meta: { changes: 0 } });
            throw new Error('UNIQUE constraint failed');
          }
          table(name).push(row);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        const update = /UPDATE (\w+) SET (.+?) WHERE (.+)/i.exec(q);
        if (update) {
          const [, name, sets, where] = update;
          const assignments = sets.split(',').map((s) => s.trim());
          const setCount = assignments.filter((a) => /= \?$/.test(a)).length;
          const setParams = params.slice(0, setCount);
          const whereParams = params.slice(setCount);
          let setIndex = 0;
          const parsed = assignments.map((a) => {
            const paramMatch = /^(\w+) = \?$/.exec(a);
            if (paramMatch) {
              const value = setParams[setIndex];
              setIndex += 1;
              return { col: paramMatch[1], value };
            }
            const litMatch = /^(\w+) = (\d+)$/.exec(a);
            if (litMatch) return { col: litMatch[1], value: Number(litMatch[2]) };
            throw new Error(`unsupported SET assignment: ${a}`);
          });
          let changed = 0;
          for (const row of table(name)) {
            if (!matchesWhere(row, where, whereParams)) continue;
            for (const { col, value } of parsed) row[col] = value;
            changed += 1;
          }
          return Promise.resolve({ success: true, meta: { changes: changed } });
        }
        const del = /DELETE FROM (\w+)(?: WHERE (.+))?/i.exec(q);
        if (del) {
          const [, name, where] = del;
          const rows = table(name);
          if (!where) {
            const n = rows.length;
            rows.length = 0;
            return Promise.resolve({ success: true, meta: { changes: n } });
          }
          let removed = 0;
          for (let i = rows.length - 1; i >= 0; i--) {
            if (matchesWhere(rows[i], where, params)) {
              rows.splice(i, 1);
              removed += 1;
            }
          }
          return Promise.resolve({ success: true, meta: { changes: removed } });
        }
        throw new Error(`unsupported statement: ${q}`);
      },
    };
  }

  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          return statement(query, [...params]);
        },
      };
    },
  } as unknown as D1Queryable;
}

const env = (overrides: Record<string, string> = {}) => ({ DB: createFakeDb(), ...overrides });

describe('collab surfaces DAO: projects end to end', () => {
  it('runs the full board lifecycle', async () => {
    const db = createFakeDb();
    const dao = new ProjectDAO(db);
    await dao.createProject({
      id: 'p1',
      repositoryId: 'r1',
      number: 1,
      title: 'Roadmap',
      description: null,
      creatorEmail: 'a@x.com',
      now: 1,
    });
    expect(await dao.nextNumber('r1')).toBe(2);
    expect(await dao.countByRepo('r1')).toBe(1);
    expect((await dao.getByNumber('r1', 1))?.title).toBe('Roadmap');
    expect((await dao.getById('p1', 'r1'))?.number).toBe(1);

    await dao.createColumn({ id: 'c1', projectId: 'p1', title: 'Todo', position: 0, now: 1 });
    await dao.createColumn({ id: 'c2', projectId: 'p1', title: 'Done', position: 1, now: 2 });
    expect((await dao.listColumns('p1')).map((c) => c.title)).toEqual(['Todo', 'Done']);
    await dao.renameColumn('c1', 'p1', 'Backlog');
    expect((await dao.getColumn('c1', 'p1'))?.title).toBe('Backlog');

    await dao.createCard({
      id: 'k1',
      projectId: 'p1',
      columnId: 'c1',
      kind: 'note',
      noteTitle: 'Ship',
      noteBody: 'v1',
      issueId: null,
      pullRequestId: null,
      position: 0,
      creatorEmail: 'a@x.com',
      now: 1,
    });
    await dao.createCard({
      id: 'k2',
      projectId: 'p1',
      columnId: 'c1',
      kind: 'issue',
      noteTitle: null,
      noteBody: null,
      issueId: 'i1',
      pullRequestId: null,
      position: 1,
      creatorEmail: 'a@x.com',
      now: 1,
    });
    expect(await dao.countCardsInColumn('c1')).toBe(2);
    expect((await dao.listCards('p1')).map((c) => c.id)).toEqual(['k1', 'k2']);
    expect((await dao.getCard('k1', 'p1'))?.note_title).toBe('Ship');

    await dao.moveCard('k1', 'p1', 'c2', 0, 3);
    expect((await dao.getCard('k1', 'p1'))?.column_id).toBe('c2');
    await dao.setCardArchived('k2', 'p1', true, 4);
    expect((await dao.listCards('p1')).map((c) => c.id)).toEqual(['k1']);
    expect(await dao.listCards('p1', true)).toHaveLength(2);
    await dao.deleteCard('k2', 'p1');
    expect(await dao.listCards('p1', true)).toHaveLength(1);

    await dao.updateProject('p1', 'r1', { title: 'Roadmap v2', description: 'Desc' }, 5);
    expect((await dao.getByNumber('r1', 1))?.title).toBe('Roadmap v2');
    await dao.setStatus('p1', 'r1', 'closed', 6);
    expect((await dao.getByNumber('r1', 1))?.status).toBe('closed');

    await dao.deleteColumn('c2', 'p1');
    expect((await dao.listColumns('p1')).map((c) => c.id)).toEqual(['c1']);
    await dao.deleteProject('p1', 'r1');
    expect(await dao.listByRepo('r1')).toHaveLength(0);
    await dao.deleteByRepo('r1');
  });
});

describe('collab surfaces DAO: discussions end to end', () => {
  it('seeds categories and runs the thread lifecycle', async () => {
    const db = createFakeDb();
    const dao = new DiscussionDAO(db);
    const seeded = await dao.ensureDefaultCategories('r1', 1);
    expect(seeded.map((c) => c.slug).sort()).toEqual(['announcements', 'general', 'ideas', 'qa']);
    expect(await dao.ensureDefaultCategories('r1', 1)).toHaveLength(4);
    expect((await dao.getCategoryBySlug('r1', 'general'))?.kind).toBe('general');
    const general = (await dao.getCategoryBySlug('r1', 'general'))!;
    expect((await dao.getCategoryById(general.id, 'r1'))?.slug).toBe('general');
    await dao.createCategory({
      id: 'custom',
      repositoryId: 'r1',
      slug: 'custom',
      title: 'Custom',
      description: null,
      kind: 'general',
      now: 1,
    });
    expect(await dao.listCategories('r1')).toHaveLength(5);

    expect(await dao.nextNumber('r1')).toBe(1);
    await dao.createDiscussion({
      id: 'd1',
      repositoryId: 'r1',
      categoryId: general.id,
      number: 1,
      title: 'Hello',
      body: 'World',
      authorEmail: 'a@x.com',
      now: 1,
    });
    await dao.createDiscussion({
      id: 'd2',
      repositoryId: 'r1',
      categoryId: null,
      number: 2,
      title: 'Second',
      body: null,
      authorEmail: 'b@x.com',
      now: 2,
    });
    expect(await dao.countByRepo('r1')).toBe(2);
    expect((await dao.listByRepo('r1')).map((d) => d.number)).toEqual([2, 1]);
    expect((await dao.listByRepo('r1', general.id)).map((d) => d.id)).toEqual(['d1']);
    expect((await dao.getByNumber('r1', 1))?.title).toBe('Hello');
    expect((await dao.getById('d2'))?.title).toBe('Second');

    await dao.createComment({ id: 'm1', discussionId: 'd1', authorEmail: 'b@x.com', body: 'Hi', now: 3 });
    expect((await dao.listComments('d1')).map((c) => c.body)).toEqual(['Hi']);
    await dao.updateComment('m1', 'd1', 'Hello!', 4);
    expect((await dao.getComment('m1', 'd1'))?.body).toBe('Hello!');
    await dao.updateDiscussion('d1', { title: 'Hello!' }, 5);
    expect((await dao.getByNumber('r1', 1))?.title).toBe('Hello!');
    await dao.setStatus('d1', 'answered', 6);
    expect((await dao.getByNumber('r1', 1))?.status).toBe('answered');
    await dao.deleteComment('m1', 'd1');
    expect(await dao.listComments('d1')).toHaveLength(0);
    await dao.deleteDiscussion('d2');
    expect(await dao.countByRepo('r1')).toBe(1);
    await dao.deleteByRepo('r1');
    expect(await dao.countByRepo('r1')).toBe(0);
  });
});

describe('collab surfaces DAO: wiki end to end', () => {
  it('versions pages and searches', async () => {
    const db = createFakeDb();
    const dao = new WikiDAO(db);
    await dao.createPage({ id: 'w1', repositoryId: 'r1', slug: 'home', title: 'Home', body: 'v1 docs', authorEmail: 'a@x.com', now: 1 });
    expect(await dao.countByRepo('r1')).toBe(1);
    expect((await dao.listByRepo('r1')).map((p) => p.slug)).toEqual(['home']);
    expect((await dao.getBySlug('r1', 'home'))?.revision).toBe(1);

    const updated = await dao.updatePage('w1', 'r1', { body: 'v2 docs', expectedRevision: 1 }, 'b@x.com', 2);
    expect(updated.revision).toBe(2);
    await expect(dao.updatePage('w1', 'r1', { body: 'stale', expectedRevision: 1 }, 'c@x.com', 3)).rejects.toThrow('revision conflict');
    await expect(dao.updatePage('missing', 'r1', { body: 'x' }, 'a@x.com', 3)).rejects.toThrow('not found');
    expect((await dao.listRevisions('w1')).map((r) => r.revision)).toEqual([2, 1]);
    expect(await dao.searchByRepo('r1', 'docs', 10)).toHaveLength(1);
    expect(await dao.searchByRepo('r1', 'nothing-here', 10)).toHaveLength(0);

    await dao.deletePage('w1', 'r1');
    expect(await dao.listByRepo('r1')).toHaveLength(0);
    await dao.createPage({ id: 'w2', repositoryId: 'r1', slug: 'a', title: 'A', body: 'b', authorEmail: 'a@x.com', now: 1 });
    await dao.deleteByRepo('r1');
    expect(await dao.listByRepo('r1')).toHaveLength(0);
  });
});

describe('collab surfaces DAO: snippets end to end', () => {
  it('stores multi-file snippets with visibility', async () => {
    const db = createFakeDb();
    const dao = new SnippetDAO(db);
    await dao.createSnippet({ id: 's1', ownerEmail: 'a@x.com', title: 'Hello', visibility: 'public', now: 1 });
    await dao.addFile({ id: 'f1', snippetId: 's1', filename: 'hello.txt', body: 'hi', now: 1 });
    await dao.createSnippet({ id: 's2', ownerEmail: 'a@x.com', title: 'Secret', visibility: 'secret', now: 2 });
    expect(await dao.countByOwner('a@x.com')).toBe(2);
    expect((await dao.listByOwner('a@x.com', true)).map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect((await dao.listByOwner('a@x.com', false)).map((s) => s.id)).toEqual(['s1']);
    expect((await dao.listPublic(10)).map((s) => s.id)).toEqual(['s1']);
    expect((await dao.listFiles('s1')).map((f) => f.filename)).toEqual(['hello.txt']);

    await dao.updateSnippet('s1', { title: 'Hello!' }, 3);
    expect((await dao.getById('s1'))?.title).toBe('Hello!');
    await dao.replaceFiles(
      's1',
      [
        { filename: 'a.txt', body: '1' },
        { filename: 'b.txt', body: '2' },
      ],
      4,
    );
    expect((await dao.listFiles('s1')).map((f) => f.filename)).toEqual(['a.txt', 'b.txt']);
    expect((await dao.searchPublic('hello', 10)).map((s) => s.id)).toEqual(['s1']);
    expect(await dao.searchPublic('zzz-no-match', 10)).toHaveLength(0);

    await dao.deleteSnippet('s2');
    expect(await dao.countByOwner('a@x.com')).toBe(1);
  });
});

describe('collab surfaces services on real DAOs', () => {
  it('projects: full service flow with guards', async () => {
    const db = createFakeDb();
    const svc = new ProjectService({ DB: db }, { projectDAO: async () => new ProjectDAO(db) });
    const { number } = await svc.createProject('r1', { title: 'P', description: 'D' }, 'A@x.com');
    const board = await svc.getProjectBoard('r1', number);
    expect(board.columns).toHaveLength(3);
    expect(await svc.listProjects('r1')).toHaveLength(1);
    expect((await svc.getProject('r1', number)).title).toBe('P');

    const column = await svc.createColumn('r1', number, { title: 'Review' });
    const card = await svc.createCard('r1', number, { columnId: column.id, kind: 'note', noteTitle: 'T', noteBody: 'B' }, 'a@x.com');
    const moved = await svc.moveCard('r1', number, card.id, { toColumnId: board.columns[0].id });
    expect(moved.columnId).toBe(board.columns[0].id);
    const archived = await svc.setCardArchived('r1', number, card.id, true);
    expect(archived.archived).toBe(true);
    expect((await svc.getProjectBoard('r1', number)).cards).toHaveLength(0);
    await svc.deleteCard('r1', number, card.id);
    const renamed = await svc.renameColumn('r1', number, column.id, { title: 'QA' });
    expect(renamed.title).toBe('QA');
    await svc.deleteColumn('r1', number, column.id);
    const closed = await svc.setStatus('r1', number, 'closed');
    expect(closed.status).toBe('closed');
    const updated = await svc.updateProject('r1', number, { title: 'P2', description: null });
    expect(updated.title).toBe('P2');
    await expect(svc.getProject('r1', 999)).rejects.toThrow('not found');
    await expect(svc.createCard('r1', number, { columnId: board.columns[0].id, kind: 'pull' }, 'a@x.com')).rejects.toThrow(
      'pullRequestId is required',
    );
    const issueCard = await svc.createCard('r1', number, { columnId: board.columns[0].id, kind: 'issue', issueId: 'i1' }, 'a@x.com');
    expect(issueCard.kind).toBe('issue');
    const pullCard = await svc.createCard('r1', number, { columnId: board.columns[0].id, kind: 'pull', pullRequestId: 'p9' }, 'a@x.com');
    expect(pullCard.kind).toBe('pull');
    await expect(svc.moveCard('r1', number, issueCard.id, { toColumnId: 'nope' })).rejects.toThrow('unknown target column');
    await expect(svc.setCardArchived('r1', number, issueCard.id, 'yes')).rejects.toThrow('must be a boolean');
    await expect(svc.setStatus('r1', number, 'bogus')).rejects.toThrow('must be open or closed');
    await svc.deleteProject('r1', number);
    expect(await svc.listProjects('r1')).toHaveLength(0);
  });

  it('discussions: service flow with categories and locks', async () => {
    const db = createFakeDb();
    const svc = new DiscussionService({ DB: db }, { discussionDAO: async () => new DiscussionDAO(db) });
    expect((await svc.listCategories('r1')).map((c) => c.slug)).toContain('general');
    const d = await svc.createDiscussion('r1', { title: 'Q', body: 'help @someone', categorySlug: 'qa' }, 'a@x.com');
    expect((await svc.listDiscussions('r1')).map((x) => x.number)).toEqual([1]);
    expect((await svc.listDiscussions('r1', 'qa')).map((x) => x.id)).toEqual([d.id]);
    expect(await svc.listDiscussions('r1', 'nope')).toEqual([]);
    expect((await svc.getDiscussion('r1', 1)).title).toBe('Q');
    const withComments = await svc.getDiscussionWithComments('r1', 1);
    expect(withComments.comments).toHaveLength(0);
    const comment = await svc.addComment('r1', 1, { body: 'answer' }, 'b@x.com');
    expect(comment.body).toBe('answer');
    const edited = await svc.updateComment('r1', 1, comment.id, { body: 'better answer' });
    expect(edited.body).toBe('better answer');
    await svc.deleteComment('r1', 1, comment.id);
    const renamed = await svc.updateDiscussion('r1', 1, { title: 'Q!' });
    expect(renamed.title).toBe('Q!');
    await svc.setStatus('r1', 1, 'locked');
    await expect(svc.updateDiscussion('r1', 1, { title: 'Nope' })).rejects.toThrow('locked');
    await svc.setStatus('r1', 1, 'open');
    await svc.deleteDiscussion('r1', 1);
    expect(await svc.listDiscussions('r1')).toHaveLength(0);
    await expect(svc.getDiscussion('r1', 1)).rejects.toThrow('not found');
  });

  it('wiki: service flow with slug validation', async () => {
    const db = createFakeDb();
    const svc = new WikiService({ DB: db }, { wikiDAO: async () => new WikiDAO(db) });
    const page = await svc.createPage('r1', { slug: 'Home', title: 'Home', body: '# Hi' }, 'a@x.com');
    expect(page.slug).toBe('home');
    await expect(svc.createPage('r1', { slug: 'home', title: 'Dup' }, 'a@x.com')).rejects.toThrow('already exists');
    expect((await svc.listPages('r1')).map((p) => p.slug)).toEqual(['home']);
    expect((await svc.getPage('r1', 'home')).revision).toBe(1);
    const updated = await svc.updatePage('r1', 'home', { title: 'Home!', body: '# Hi!' }, 'b@x.com');
    expect(updated.revision).toBe(2);
    expect(await svc.listRevisions('r1', 'home')).toHaveLength(2);
    expect(await svc.searchPages('r1', 'hi')).toHaveLength(1);
    await svc.deletePage('r1', 'home');
    expect(await svc.listPages('r1')).toHaveLength(0);
    expect(WikiService.normalizeSlug('  Hello World  ')).toBe('hello-world');
  });

  it('snippets: service flow with ownership', async () => {
    const db = createFakeDb();
    const svc = new SnippetService({ DB: db }, { snippetDAO: async () => new SnippetDAO(db) });
    const created = await svc.createSnippet('a@x.com', { title: 'T', visibility: 'secret', files: [{ filename: 'a.txt', body: '1' }] });
    expect(created.files).toHaveLength(1);
    expect((await svc.getSnippet(created.snippet.id, 'a@x.com')).snippet.title).toBe('T');
    expect(await svc.listByOwner('a@x.com', 'a@x.com')).toHaveLength(1);
    expect(await svc.listByOwner('a@x.com', 'stranger@x.com')).toHaveLength(0);
    expect(await svc.listPublic()).toHaveLength(0);
    const updated = await svc.updateSnippet(created.snippet.id, 'a@x.com', {
      visibility: 'public',
      files: [{ filename: 'b.txt', body: '2' }],
    });
    expect(updated.snippet.visibility).toBe('public');
    expect(await svc.listPublic()).toHaveLength(1);
    await expect(svc.updateSnippet(created.snippet.id, 'stranger@x.com', { title: 'Hax' })).rejects.toThrow('Only the snippet owner');
    await expect(svc.deleteSnippet(created.snippet.id, 'stranger@x.com')).rejects.toThrow('Only the snippet owner');
    await svc.deleteSnippet(created.snippet.id, 'a@x.com');
    await expect(svc.getSnippet(created.snippet.id, 'a@x.com')).rejects.toThrow('not found');
  });

  it('search DAO falls back to LIKE without FTS5', async () => {
    const db = createFakeDb();
    const search = new SearchDAO(db);
    const discussions = new DiscussionDAO(db);
    await discussions.ensureDefaultCategories('r1', 1);
    await discussions.createDiscussion({
      id: 'd1',
      repositoryId: 'r1',
      categoryId: null,
      number: 1,
      title: 'Searchable Hello',
      body: 'world body',
      authorEmail: 'a@x.com',
      now: 1,
    });
    const snippets = new SnippetDAO(db);
    await snippets.createSnippet({ id: 's1', ownerEmail: 'a@x.com', title: 'Searchable Snippet', visibility: 'public', now: 1 });
    expect((await search.searchDiscussions('hello', { repoId: 'r1' })).map((d) => d.id)).toEqual(['d1']);
    expect(await search.searchDiscussions('zzz-nope', { repoId: 'r1' })).toHaveLength(0);
    expect(await search.searchDiscussions('')).toHaveLength(0);
    expect((await search.searchSnippets('snippet')).map((s) => s.id)).toEqual(['s1']);
    expect(await search.searchSnippets('')).toHaveLength(0);
  });

  it('configuration env passthrough', () => {
    expect(env().DB).toBeDefined();
  });
});
