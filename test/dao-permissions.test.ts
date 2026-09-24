import { describe, expect, it } from 'vitest';
import {
  NamespaceDAO,
  OrganizationDAO,
  OrganizationMemberDAO,
  RepoCollaboratorDAO,
  RepositoryDAO,
  UserDAO,
} from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';

function createPermFakeDb() {
  const state = {
    namespaces: [] as Array<Record<string, unknown>>,
    orgs: [] as Array<Record<string, unknown>>,
    members: [] as Array<Record<string, unknown>>,
    collabs: [] as Array<Record<string, unknown>>,
    users: [] as Array<Record<string, unknown>>,
    repos: [] as Array<Record<string, unknown>>,
  };

  function statement(query: string, params: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    return {
      first<T>(): Promise<T | null> {
        if (q.includes('FROM namespaces WHERE username_ci = ?')) {
          return Promise.resolve((state.namespaces.find((n) => n.username_ci === params[0]) ?? null) as T | null);
        }
        if (q.includes('FROM organizations WHERE username_ci = ?')) {
          return Promise.resolve((state.orgs.find((o) => o.username_ci === params[0]) ?? null) as T | null);
        }
        if (q.includes('FROM organizations WHERE id = ?')) {
          return Promise.resolve((state.orgs.find((o) => o.id === params[0]) ?? null) as T | null);
        }
        if (q.includes('FROM organization_members WHERE org_id = ? AND') && q.includes('user_email')) {
          return Promise.resolve(
            (state.members.find((m) => m.org_id === params[0] && String(m.user_email).toLowerCase() === String(params[1]).toLowerCase()) ??
              null) as T | null,
          );
        }
        if (q.includes('COUNT(*) AS n FROM organization_members')) {
          const n = state.members.filter((m) => m.org_id === params[0] && m.role === 'owner').length;
          return Promise.resolve({ n } as unknown as T);
        }
        if (q.includes('FROM repo_collaborators WHERE repo_id = ? AND') && q.includes('user_email')) {
          return Promise.resolve(
            (state.collabs.find((c) => c.repo_id === params[0] && String(c.user_email).toLowerCase() === String(params[1]).toLowerCase()) ??
              null) as T | null,
          );
        }
        if (q.includes('FROM users WHERE email = ?') || q.includes('FROM users WHERE lower(email)')) {
          return Promise.resolve(
            (state.users.find((u) => String(u.email).toLowerCase() === String(params[0]).toLowerCase()) ?? null) as T | null,
          );
        }
        if (q.includes('FROM users WHERE lower(username) = ?')) {
          return Promise.resolve((state.users.find((u) => (u.username as string)?.toLowerCase() === params[0]) ?? null) as T | null);
        }
        if (q.includes('FROM repositories WHERE id = ?')) {
          return Promise.resolve((state.repos.find((r) => r.id === params[0]) ?? null) as T | null);
        }
        if (q.includes('FROM repositories WHERE owner_ci = ? AND name_ci = ?')) {
          return Promise.resolve(
            (state.repos.find(
              (r) =>
                String(r.owner_ci ?? r.owner).toLowerCase() === String(params[0]).toLowerCase() &&
                String(r.name_ci ?? r.name).toLowerCase() === String(params[1]).toLowerCase(),
            ) ?? null) as T | null,
          );
        }
        return Promise.resolve(null);
      },
      all<T>(): Promise<{ results: T[] }> {
        if (q.includes('FROM organization_members WHERE org_id = ?')) {
          return Promise.resolve({ results: state.members.filter((m) => m.org_id === params[0]) as T[] });
        }
        if (q.includes('FROM organization_members WHERE') && q.includes('user_email')) {
          return Promise.resolve({
            results: state.members.filter((m) => String(m.user_email).toLowerCase() === String(params[0]).toLowerCase()) as T[],
          });
        }
        if (q.includes('FROM repo_collaborators WHERE repo_id = ?')) {
          return Promise.resolve({ results: state.collabs.filter((c) => c.repo_id === params[0]) as T[] });
        }
        if (q.includes('FROM repo_collaborators WHERE') && q.includes('user_email')) {
          return Promise.resolve({
            results: state.collabs.filter((c) => String(c.user_email).toLowerCase() === String(params[0]).toLowerCase()) as T[],
          });
        }
        if (q.includes('FROM repositories WHERE org_id = ?')) {
          return Promise.resolve({ results: state.repos.filter((r) => r.org_id === params[0]) as T[] });
        }
        if (q.includes('JOIN repo_collaborators')) {
          const ids = new Set(
            state.collabs.filter((c) => String(c.user_email).toLowerCase() === String(params[0]).toLowerCase()).map((c) => c.repo_id),
          );
          return Promise.resolve({ results: state.repos.filter((r) => ids.has(r.id)) as T[] });
        }
        if (q.includes('FROM repositories WHERE owner_ci = ?')) {
          return Promise.resolve({
            results: state.repos.filter((r) => String(r.owner_ci ?? r.owner).toLowerCase() === String(params[0]).toLowerCase()) as T[],
          });
        }
        if (q.includes('FROM repositories WHERE lower(owner) = ?')) {
          return Promise.resolve({ results: state.repos.filter((r) => (r.owner as string).toLowerCase() === params[0]) as T[] });
        }
        if (q.includes('FROM repositories WHERE owner_email = ?') || q.includes('FROM repositories WHERE lower(owner_email)')) {
          return Promise.resolve({
            results: state.repos.filter((r) => String(r.owner_email).toLowerCase() === String(params[0]).toLowerCase()) as T[],
          });
        }
        return Promise.resolve({ results: [] });
      },
      run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
        if (q.startsWith('INSERT INTO namespaces')) {
          const [username_ci, kind, user_email, org_id, created_at] = params as Array<string | number | null>;
          if (q.includes('OR IGNORE')) {
            if (!state.namespaces.some((n) => n.username_ci === username_ci))
              state.namespaces.push({ username_ci, kind, user_email, org_id, created_at });
          } else {
            state.namespaces.push({ username_ci, kind, user_email, org_id, created_at });
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM namespaces')) {
          state.namespaces = state.namespaces.filter((n) => n.username_ci !== params[0]);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO organizations')) {
          const [id, username, username_ci, creator_email, created_at, updated_at] = params as Array<string | number | null>;
          state.orgs.push({ id, username, username_ci, creator_email, created_at, updated_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE organizations SET username')) {
          const row = state.orgs.find((o) => o.id === params[3]);
          if (row) {
            row.username = params[0];
            row.username_ci = params[1];
            row.updated_at = params[2];
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM organizations')) {
          state.orgs = state.orgs.filter((o) => o.id !== params[0]);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO organization_members')) {
          const [org_id, user_email, role, created_at] = params as Array<string | number>;
          const normalized = String(user_email).toLowerCase();
          // Collapse legacy case-variant duplicates like the real DAO.
          state.members = state.members.filter(
            (m) => !(m.org_id === org_id && String(m.user_email).toLowerCase() === normalized && m.user_email !== normalized),
          );
          const existing = state.members.find((m) => m.org_id === org_id && m.user_email === normalized);
          if (existing) existing.role = role;
          else state.members.push({ org_id, user_email: normalized, role, created_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM organization_members WHERE org_id = ? AND') && q.includes('user_email')) {
          if (params.length >= 3) {
            state.members = state.members.filter(
              (m) =>
                !(
                  m.org_id === params[0] &&
                  String(m.user_email).toLowerCase() === String(params[1]).toLowerCase() &&
                  m.user_email !== params[2]
                ),
            );
          } else {
            state.members = state.members.filter(
              (m) => !(m.org_id === params[0] && String(m.user_email).toLowerCase() === String(params[1]).toLowerCase()),
            );
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM organization_members WHERE org_id = ?')) {
          state.members = state.members.filter((m) => m.org_id !== params[0]);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO repo_collaborators')) {
          const [repo_id, user_email, role, granted_by, created_at] = params as Array<string | number | null>;
          const normalized = String(user_email).toLowerCase();
          const normalizedGrant = granted_by == null ? null : String(granted_by).toLowerCase();
          state.collabs = state.collabs.filter(
            (c) => !(c.repo_id === repo_id && String(c.user_email).toLowerCase() === normalized && c.user_email !== normalized),
          );
          const existing = state.collabs.find((c) => c.repo_id === repo_id && c.user_email === normalized);
          if (existing) {
            existing.role = role;
            existing.granted_by = normalizedGrant;
          } else state.collabs.push({ repo_id, user_email: normalized, role, granted_by: normalizedGrant, created_at });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM repo_collaborators WHERE repo_id = ? AND') && q.includes('user_email')) {
          if (params.length >= 3) {
            state.collabs = state.collabs.filter(
              (c) =>
                !(
                  c.repo_id === params[0] &&
                  String(c.user_email).toLowerCase() === String(params[1]).toLowerCase() &&
                  c.user_email !== params[2]
                ),
            );
          } else {
            state.collabs = state.collabs.filter(
              (c) => !(c.repo_id === params[0] && String(c.user_email).toLowerCase() === String(params[1]).toLowerCase()),
            );
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('DELETE FROM repo_collaborators WHERE repo_id = ?')) {
          state.collabs = state.collabs.filter((c) => c.repo_id !== params[0]);
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO users')) {
          const [email, created_at] = params as Array<string | number>;
          if (!state.users.some((u) => u.email === email)) state.users.push({ email, created_at, username: null, updated_at: null });
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE users SET username')) {
          const row = state.users.find((u) => u.email === params[2]);
          if (row) {
            if (q.includes('COALESCE')) {
              if (!row.username) {
                row.username = params[0];
                row.updated_at = params[1];
              }
            } else {
              row.username = params[0];
              row.updated_at = params[1];
            }
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('INSERT INTO repositories')) {
          if (q.includes('owner_type')) {
            const [
              id,
              owner_email,
              owner,
              name,
              description,
              is_private,
              created_at,
              updated_at,
              owner_type,
              owner_ci,
              name_ci,
              owner_user_email,
              org_id,
            ] = params as Array<string | number | null>;
            state.repos.push({
              id,
              owner_email,
              owner,
              name,
              description,
              is_private,
              created_at,
              updated_at,
              owner_type,
              owner_ci,
              name_ci,
              owner_user_email,
              org_id,
            });
          } else {
            const [id, owner_email, owner, name, description, is_private, created_at, updated_at] = params as Array<string | number | null>;
            state.repos.push({ id, owner_email, owner, name, description, is_private, created_at, updated_at });
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        if (q.startsWith('UPDATE repositories SET owner')) {
          for (const r of state.repos) {
            const target = params[params.length - 1] as string;
            if ((r.owner as string).toLowerCase() === target.toLowerCase?.() || r.owner === target || r.owner_ci === target) {
              r.owner = params[0];
              // Single-path rename: (owner, owner_ci, updated_at, where owner_ci).
              if (params.length === 4) {
                r.owner_ci = params[1];
                r.updated_at = params[2];
              } else if (params.length === 3) r.owner_ci = params[1];
            }
          }
          return Promise.resolve({ success: true, meta: { changes: 1 } });
        }
        return Promise.resolve({ success: true, meta: { changes: 1 } });
      },
    };
  }

  const db = { ...state, prepare: (query: string) => ({ bind: (...params: unknown[]) => statement(query, params) }) };
  return { db: db as unknown as D1Queryable, state };
}

describe('NamespaceDAO', () => {
  it('claims, checks, and releases', async () => {
    const { db } = createPermFakeDb();
    const dao = new NamespaceDAO(db);
    await expect(dao.isTaken('alice')).resolves.toBe(false);
    await dao.claim({ usernameCi: 'alice', kind: 'user', userEmail: 'a@x.co', now: 1 });
    await expect(dao.isTaken('alice')).resolves.toBe(true);
    await expect(dao.get('alice')).resolves.toMatchObject({ kind: 'user' });
    await dao.claimIgnore({ usernameCi: 'alice', kind: 'user', userEmail: 'a@x.co', now: 1 });
    await dao.release('alice');
    await expect(dao.isTaken('alice')).resolves.toBe(false);
  });
});

describe('OrganizationDAO', () => {
  it('creates, renames, and deletes', async () => {
    const { db } = createPermFakeDb();
    const dao = new OrganizationDAO(db);
    await dao.create({ id: 'o1', username: 'acme', creatorEmail: 'a@x.co', now: 1 });
    await expect(dao.getById('o1')).resolves.toMatchObject({ username: 'acme' });
    await expect(dao.getByUsernameCi('acme')).resolves.toMatchObject({ id: 'o1' });
    await dao.rename('o1', 'acme-new', 2);
    await expect(dao.getById('o1')).resolves.toMatchObject({ username: 'acme-new' });
    await dao.deleteById('o1');
    await expect(dao.getById('o1')).resolves.toBeNull();
  });
});

describe('OrganizationMemberDAO', () => {
  it('upserts, lists, counts owners, and removes', async () => {
    const { db } = createPermFakeDb();
    const dao = new OrganizationMemberDAO(db);
    await dao.upsert('o1', 'a@x.co', 'owner', 1);
    await dao.upsert('o1', 'b@x.co', 'member', 1);
    await dao.upsert('o1', 'b@x.co', 'owner', 2);
    await expect(dao.get('o1', 'b@x.co')).resolves.toMatchObject({ role: 'owner' });
    await expect(dao.listByOrg('o1')).resolves.toHaveLength(2);
    await expect(dao.listOrgsByUser('a@x.co')).resolves.toHaveLength(1);
    await expect(dao.countOwners('o1')).resolves.toBe(2);
    await dao.remove('o1', 'b@x.co');
    await expect(dao.countOwners('o1')).resolves.toBe(1);
    await dao.deleteByOrg('o1');
    await expect(dao.listByOrg('o1')).resolves.toHaveLength(0);
  });

  it('matches emails case-insensitively and collapses case variants', async () => {
    const { db } = createPermFakeDb();
    const dao = new OrganizationMemberDAO(db);
    await dao.upsert('o1', 'Owner@X.Co', 'owner', 1);
    await expect(dao.get('o1', 'owner@x.co')).resolves.toMatchObject({ role: 'owner' });
    await expect(dao.get('o1', 'OWNER@X.CO')).resolves.toMatchObject({ role: 'owner' });
    await expect(dao.listOrgsByUser('OWNER@x.co')).resolves.toHaveLength(1);
    await dao.upsert('o1', 'owner@x.co', 'member', 2);
    await expect(dao.listByOrg('o1')).resolves.toHaveLength(1);
    await expect(dao.get('o1', 'OWNER@X.CO')).resolves.toMatchObject({ role: 'member' });
    await dao.remove('o1', 'OWNER@X.CO');
    await expect(dao.get('o1', 'owner@x.co')).resolves.toBeNull();
  });
});

describe('RepoCollaboratorDAO', () => {
  it('upserts, lists, and removes grants', async () => {
    const { db } = createPermFakeDb();
    const dao = new RepoCollaboratorDAO(db);
    await dao.upsert('r1', 'b@x.co', 'read', 'a@x.co', 1);
    await dao.upsert('r1', 'b@x.co', 'write', 'a@x.co', 2);
    await expect(dao.get('r1', 'b@x.co')).resolves.toMatchObject({ role: 'write' });
    await expect(dao.listByRepo('r1')).resolves.toHaveLength(1);
    await expect(dao.listByUser('b@x.co')).resolves.toHaveLength(1);
    await dao.remove('r1', 'b@x.co');
    await expect(dao.get('r1', 'b@x.co')).resolves.toBeNull();
    await dao.upsert('r1', 'b@x.co', 'read', null, 1);
    await dao.deleteByRepo('r1');
    await expect(dao.listByRepo('r1')).resolves.toHaveLength(0);
  });
});

describe('UserDAO usernames', () => {
  it('ensures, sets username, and case-insensitive lookup', async () => {
    const { db } = createPermFakeDb();
    const dao = new UserDAO(db);
    await dao.upsertUser('a@x.co', 1);
    await dao.ensureUsername('a@x.co', 'Alice', 2);
    await dao.ensureUsername('a@x.co', 'Other', 2);
    await expect(dao.getByEmail('a@x.co')).resolves.toMatchObject({ username: 'Alice' });
    await expect(dao.getByUsernameCi('alice')).resolves.toMatchObject({ email: 'a@x.co' });
    await dao.setUsername('a@x.co', 'alice-new', 3);
    await expect(dao.getByEmail('a@x.co')).resolves.toMatchObject({ username: 'alice-new' });
  });
});

describe('RepositoryDAO permissions columns', () => {
  it('creates with owner columns, lists by org/collab, renames owner', async () => {
    const { db } = createPermFakeDb();
    const dao = new RepositoryDAO(db);
    await dao.create({
      id: 'r1',
      ownerEmail: 'a@x.co',
      owner: 'acme',
      name: 'api',
      description: null,
      isPrivate: true,
      now: 1,
      ownerType: 'org',
      orgId: 'o1',
    });
    await expect(dao.getByOwnerAndName('ACME', 'API')).resolves.toMatchObject({ id: 'r1' });
    await expect(dao.listByOrgId('o1')).resolves.toHaveLength(1);
    await expect(dao.listByCollaboratorEmail('nobody@x.co')).resolves.toHaveLength(0);
    await dao.renameOwner('acme', 'acme-new');
    await expect(dao.getByOwnerAndName('acme-new', 'api')).resolves.toMatchObject({ id: 'r1' });
    await expect(dao.listByOwner('ACME-NEW')).resolves.toHaveLength(1);
  });
});
