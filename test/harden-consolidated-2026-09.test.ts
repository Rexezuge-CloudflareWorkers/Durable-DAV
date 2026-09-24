import { describe, expect, it, vi } from 'vitest';
import { maxTeamGrantRole } from '@duradav/backend-services/permission';
import { assertQuotaWithinLimit } from '@duradav/backend-services/policy';
import { assertNotLastTeamAdmin, assertNotLastOrgOwner } from '@duradav/backend-services/policy';
import { backoffSecondsForAttempt, isRetryableHttpStatus } from '@duradav/backend-services/webhook';
import { isBlockedByReviews } from '@duradav/backend-services/pull';
import { classifyCreatePath } from '@duradav/backend-services/repo';
import { createDefaultRepoServiceDeps } from '@duradav/backend-services/repo';
import { resolveCallerUsernameLowercased, resolveCreationContext, enqueueVacuumTombstone } from '@duradav/backend-services/repo';
import { defaultPostJson, STORED_ERROR_CHAR_LIMIT } from '@duradav/backend-services/webhook';
import { toServiceStatus, mapServiceError } from '@duradav/backend-services/errors';
import { DomainEventBus } from '@duradav/backend-services/events';
import { BadRequestError, ForbiddenError, NotFoundError } from '@duradav/backend-errors';
import { SearchDAO } from '@duradav/backend-data/dao';
import { BaseRoute } from '@/endpoints/IBaseRoute';

function fakeDb(handlers: Record<string, (sql: string, params: unknown[]) => unknown>) {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            all: async () => {
              for (const [key, fn] of Object.entries(handlers)) {
                if (sql.includes(key)) return { results: (await fn(sql, params)) as never[] };
              }
              throw new Error(`no such table: ${sql.slice(0, 40)}`);
            },
            first: async () => null,
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      };
    },
  } as never;
}

describe('harden consolidated: pure policies (Policy pattern)', () => {
  it('maxTeamGrantRole picks max applicable grant', () => {
    const grants = [
      { team_id: 't1', role: 'read' as const },
      { team_id: 't2', role: 'write' as const },
      { team_id: 't3', role: 'admin' as const },
    ];
    expect(
      maxTeamGrantRole(
        grants,
        () => true,
        () => true,
      ),
    ).toBe('admin');
    expect(
      maxTeamGrantRole(
        grants,
        (id) => id !== 't3',
        () => true,
      ),
    ).toBe('write');
    expect(
      maxTeamGrantRole(
        grants,
        () => true,
        (id) => id === 't1',
      ),
    ).toBe('read');
    expect(
      maxTeamGrantRole(
        [],
        () => true,
        () => true,
      ),
    ).toBeNull();
  });

  it('assertQuotaWithinLimit fails closed at cap', () => {
    expect(() => assertQuotaWithinLimit(4, 5, 'teams')).not.toThrow();
    expect(() => assertQuotaWithinLimit(5, 5, 'teams')).toThrow(BadRequestError);
  });

  it('membership guards reject last privileged removal', () => {
    expect(() => assertNotLastTeamAdmin('admin', 1, 'remove')).toThrow(BadRequestError);
    expect(() => assertNotLastTeamAdmin('admin', 2, 'remove')).not.toThrow();
    expect(() => assertNotLastTeamAdmin('member', 1, 'remove')).not.toThrow();
    expect(() => assertNotLastOrgOwner('owner', 1, 'demote')).toThrow(BadRequestError);
  });

  it('webhook retry policy table', () => {
    expect(isRetryableHttpStatus(null)).toBe(true);
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(500)).toBe(true);
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(isRetryableHttpStatus(200)).toBe(false);
    expect(backoffSecondsForAttempt(1)).toBe(60);
    expect(backoffSecondsForAttempt(99)).toBe(86_400);
  });

  it('pull review gate ignores dismissed and latest-wins', () => {
    expect(isBlockedByReviews([{ author_email: 'a@x.com', state: 'changes_requested', dismissed: 1 }])).toBe(false);
    expect(isBlockedByReviews([{ author_email: 'a@x.com', state: 'changes_requested' }])).toBe(true);
    expect(
      isBlockedByReviews([
        { author_email: 'a@x.com', state: 'changes_requested' },
        { author_email: 'a@x.com', state: 'approved' },
      ]),
    ).toBe(false);
  });

  it('classifyCreatePath precedence: self > org > legacy > forbidden', () => {
    expect(
      classifyCreatePath({
        ownerCi: 'alice',
        callerCi: 'alice',
        org: null,
        isOrgMember: false,
        namespaceOwnerEmail: null,
        callerEmail: 'alice@x.com',
      }).kind,
    ).toBe('self');
    const org = { id: 'o1', username: 'acme' };
    expect(
      classifyCreatePath({ ownerCi: 'acme', callerCi: 'bob', org, isOrgMember: false, namespaceOwnerEmail: null, callerEmail: 'bob@x.com' })
        .kind,
    ).toBe('forbidden');
    expect(
      classifyCreatePath({ ownerCi: 'acme', callerCi: 'bob', org, isOrgMember: true, namespaceOwnerEmail: null, callerEmail: 'bob@x.com' })
        .kind,
    ).toBe('org');
  });
});

describe('harden consolidated: extracted modules', () => {
  it('createDefaultRepoServiceDeps wires real DAOs and fail-closed stubs', async () => {
    const db = fakeDb({});
    const deps = createDefaultRepoServiceDeps({ DB: db });
    await expect(deps.repositoryDAO()).resolves.toBeDefined();
    await expect(deps.importDAO()).rejects.toThrow('injected importDAO');
    await expect(deps.mirrorDAO()).rejects.toThrow('injected mirrorDAO');
    await expect(deps.webhookDAO()).rejects.toThrow('injected webhookDAO');
  });

  it('resolveCallerUsernameLowercased falls back to email prefix', async () => {
    const userDAO = () => Promise.resolve({ getByEmail: async () => null } as never);
    await expect(resolveCallerUsernameLowercased(userDAO, 'Alice@Example.com')).resolves.toBe('alice');
    const withUser = () => Promise.resolve({ getByEmail: async () => ({ username: 'Bob' }) } as never);
    await expect(resolveCallerUsernameLowercased(withUser, 'bob@x.com')).resolves.toBe('bob');
  });

  it('resolveCreationContext degrades independently on DAO outage', async () => {
    const failing = () => Promise.reject(new Error('D1 down'));
    const ctx = await resolveCreationContext(
      { organizationDAO: failing as never, organizationMemberDAO: failing as never, namespaceDAO: failing as never },
      { ownerCi: 'alice', callerCi: 'alice', callerEmail: 'alice@x.com' },
    );
    expect(ctx).toEqual({ org: null, isOrgMember: false, namespaceOwnerEmail: null });
  });

  it('enqueueVacuumTombstone never throws', async () => {
    const deps = { deletedRepoDoDAO: () => Promise.reject(new Error('D1 down')) } as never;
    await expect(enqueueVacuumTombstone(deps, { owner: 'a', name: 'r', id: 'id1' } as never)).resolves.toBeUndefined();
    const ok = { deletedRepoDoDAO: () => Promise.resolve({ enqueue: async () => undefined }) } as never;
    await expect(enqueueVacuumTombstone(ok, { owner: 'a', name: 'r', id: 'id1' } as never)).resolves.toBeUndefined();
  });

  it('defaultPostJson rejects SSRF and truncates stored errors', async () => {
    const blocked = await defaultPostJson('http://127.0.0.1/hook', { headers: {}, body: '{}', timeoutMs: 1000 });
    expect(blocked.httpStatus).toBeNull();
    expect(blocked.error?.length).toBeLessThanOrEqual(STORED_ERROR_CHAR_LIMIT);
  });

  it('ErrorMapper toServiceStatus collapses unknown to 500', () => {
    expect(toServiceStatus(new BadRequestError('bad'))).toBe(400);
    expect(toServiceStatus(new ForbiddenError('no'))).toBe(403);
    expect(toServiceStatus(new NotFoundError('missing'))).toBe(404);
    expect(toServiceStatus(new Error('boom'))).toBe(500);
    expect(mapServiceError(new Error('boom')).status).toBe(500);
  });

  it('BaseRoute error-type registry covers all wire statuses', () => {
    expect(BaseRoute.toErrorType(400)).toBe('BadRequest');
    expect(BaseRoute.toErrorType(401)).toBe('Unauthorized');
    expect(BaseRoute.toErrorType(403)).toBe('Forbidden');
    expect(BaseRoute.toErrorType(404)).toBe('NotFound');
    expect(BaseRoute.toErrorType(409)).toBe('Conflict');
    expect(BaseRoute.toErrorType(413)).toBe('PayloadTooLarge');
    expect(BaseRoute.toErrorType(429)).toBe('RateLimited');
    expect(BaseRoute.toErrorType(500)).toBe('InternalServerError');
    expect(BaseRoute.toErrorType(999)).toBe('InternalServerError');
  });

  it('DomainEventBus never throws on failing subscriber', async () => {
    const bus = DomainEventBus.withHandlers([
      {
        type: 'repo_created' as never,
        handler: () => {
          throw new Error('subscriber down');
        },
      },
    ]);
    await expect(bus.emit({ type: 'repo_created' } as never)).resolves.toBeUndefined();
    expect(bus.size).toBe(1);
  });
});

describe('harden consolidated: SearchDAO unified fallback', () => {
  it('searchRepos falls back to LIKE when FTS is absent', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind(..._params: unknown[]) {
            return {
              all: async () => {
                if (sql.includes('repo_fts')) throw new Error('no such table: repo_fts');
                if (sql.includes('FROM repositories WHERE')) return { results: [{ id: 'r1' }] };
                throw new Error(`unexpected sql ${sql}`);
              },
              run: async () => ({ meta: { changes: 0 } }),
            };
          },
        };
      },
    } as never;
    const dao = new SearchDAO(db);
    await expect(dao.searchRepos('hello')).resolves.toEqual([{ id: 'r1' }]);
  });

  it('pruneStaleCodePaths alias preserves legacy name', async () => {
    const db = {
      prepare(_sql: string) {
        return {
          bind(..._params: unknown[]) {
            return {
              all: async () => ({ results: [] }),
              run: async () => ({ success: true, meta: { changes: 2 } }),
            };
          },
        };
      },
    } as never;
    const dao = new SearchDAO(db);
    expect(typeof dao.pruneStaleCodePaths).toBe('function');
    expect(typeof dao.deleteCodePathsNotIn).toBe('function');
    await expect(dao.pruneStaleCodePaths('r1', ['keep.ts'])).resolves.toBe(2);
    await expect(dao.deleteCodePathsNotIn('r1', ['keep.ts'])).resolves.toBe(2);
  });

  it('composition tokens registry resolves without throwing', async () => {
    const { Tokens } = await import('@duradav/backend-services/composition');
    for (const key of ['RepoService', 'PermissionService', 'WebhookDeliveryService', 'SearchService', 'DomainEventBus'] as const) {
      expect(Tokens[key]).toBeDefined();
    }
    vi.useRealTimers();
  });
});
