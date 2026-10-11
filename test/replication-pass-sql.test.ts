import { describe, expect, it } from 'vitest';
import { recordRunStatement } from '../packages/backend-data/src/dao/replicationPassSql';
import type { D1Queryable } from '../packages/backend-data/src/utils/D1Types';

/**
 * When a pass opens and closes the deletion gate.
 *
 * `pass_started_at IS NOT NULL` means "this pass has not finished visiting the
 * tree". It closes on a failed pass and on a clean and complete one, and stays
 * open on a clean pass that still has queued collections — the next tick then
 * resumes from the cursor instead of restarting from the root. The expression
 * once read `!failed || remaining === 0`, which inverted both halves: a failed
 * pass with work left stayed open, while a clean partial pass closed the gate
 * and its cursor was cleared by the next `beginPass`.
 */

function fakeDb(): D1Queryable & { binds: unknown[][] } {
  const binds: unknown[][] = [];
  const statement = {
    bind: (...values: unknown[]) => {
      binds.push(values);
      return statement;
    },
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ success: true }),
  };
  const db: D1Queryable & { binds: unknown[][] } = {
    binds,
    prepare: () => statement,
  };
  return db;
}

async function closePassArg(status: 'ok' | 'partial' | 'failed', remaining: number): Promise<unknown> {
  const db = fakeDb();
  await recordRunStatement(db, 'rep_1', status, null, 1_700_000_000, 5, remaining > 0 ? 'cursor' : null, remaining);
  // Bind order: now, status, error, failed, failed, maxFailures, closePass, cursor, remaining, now, id.
  return db.binds[0]?.[6];
}

describe('recordRunStatement — the deletion gate', () => {
  it('closes the gate on a failed pass even with work left', async () => {
    await expect(closePassArg('failed', 5)).resolves.toBe(1);
  });

  it('closes the gate on a partial pass even with work left', async () => {
    // `partial` is `status !== 'ok'`: a pass that errored verified nothing, so
    // resuming mid-tree would skip collections the failure may have hidden.
    await expect(closePassArg('partial', 5)).resolves.toBe(1);
  });

  it('closes the gate on a clean and complete pass', async () => {
    await expect(closePassArg('ok', 0)).resolves.toBe(1);
  });

  it('leaves the gate open on a clean pass with work left', async () => {
    await expect(closePassArg('ok', 3)).resolves.toBe(0);
  });
});
