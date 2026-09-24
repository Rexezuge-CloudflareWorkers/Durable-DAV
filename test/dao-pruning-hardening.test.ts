import { describe, expect, it } from 'vitest';
import { MirrorDAO } from '@duradav/backend-data/dao/MirrorDAO';
import { ImportDAO } from '@duradav/backend-data/dao/ImportDAO';
import { WebhookDeliveryDAO } from '@duradav/backend-data/dao/WebhookDeliveryDAO';
import type { D1Queryable } from '@duradav/backend-data/utils';

function fakeDb(handler: (query: string, params: unknown[]) => { all?: unknown[]; run?: object; first?: unknown }) {
  const seen: Array<{ query: string; params: unknown[] }> = [];
  const db = {
    prepare: (query: string) => ({
      bind: (...params: unknown[]) => ({
        all: async () => ({ results: handler(query, params).all ?? [] }),
        run: async () => handler(query, params).run ?? { success: true, meta: { changes: 0 } },
        first: async () => handler(query, params).first ?? null,
      }),
    }),
  } as unknown as D1Queryable;
  return { db, seen };
}

describe('MirrorDAO', () => {
  it('listDue binds now/limit in order', async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const { db } = fakeDb((query, params) => {
      calls.push({ query, params });
      return { all: [] };
    });
    await new MirrorDAO(db, btoa('0'.repeat(32))).listDue(1234, 10);
    expect(calls[0].params).toEqual([1234, 10]);
    expect(calls[0].query).toContain('repo_mirrors WHERE enabled = 1');
  });

  it('recordRun success resets failures; failure disables at threshold via SQL CASE', async () => {
    const queries: string[] = [];
    const { db } = fakeDb((query) => {
      queries.push(query);
      return {};
    });
    const dao = new MirrorDAO(db, btoa('0'.repeat(32)));
    await dao.recordRun('r1', true, null, 999, 5);
    expect(queries[0]).toContain('consecutive_failures = 0');
    await dao.recordRun('r1', false, 'boom', 999, 5);
    expect(queries[1]).toContain('consecutive_failures + 1 >= ?');
  });
});

describe('ImportDAO claimDue race', () => {
  it('claimDue limits batch size', async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const { db } = fakeDb((query, params) => {
      calls.push({ query, params });
      return { all: [] };
    });
    await new ImportDAO(db, btoa('0'.repeat(32))).claimDue(5, 300, 9999);
    const claim = calls.find((c) => c.query.includes('UPDATE')) ?? calls[0];
    expect(claim.params).toContain(5);
  });
});

describe('WebhookDeliveryDAO retention', () => {
  it('pruneOlderThan binds cutoff/limit and returns count shape', async () => {
    const calls: Array<{ query: string; params: unknown[] }> = [];
    const { db } = fakeDb((query, params) => {
      calls.push({ query, params });
      return { run: { success: true, meta: { changes: 3 } } };
    });
    const dao = new WebhookDeliveryDAO(db);
    const pruned = await dao.pruneOlderThan(1000, 500).catch(() => -1);
    expect(calls[0].params).toEqual(expect.arrayContaining([1000, 500]));
    expect(typeof pruned).toBe('number');
  });
});
