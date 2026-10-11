import { describe, expect, it } from 'vitest';
import { recordRunStatement } from '../packages/backend-data/src/dao/replicationPassSql';

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

function closePassArg(status: 'ok' | 'partial' | 'failed', remaining: number): unknown {
  const statement = recordRunStatement('rep_1', status, null, 1_700_000_000, 5, remaining > 0 ? 'cursor' : null, remaining);
  // Bind order: now, status, error, failed, failed, maxFailures, closePass, cursor, remaining, now, id.
  return statement.bindings[6];
}

describe('recordRunStatement — the deletion gate', () => {
  it('closes the gate on a failed pass even with work left', () => {
    expect(closePassArg('failed', 5)).toBe(1);
  });

  it('closes the gate on a partial pass even with work left', () => {
    // `partial` is `status !== 'ok'`: a pass that errored verified nothing, so
    // resuming mid-tree would skip collections the failure may have hidden.
    expect(closePassArg('partial', 5)).toBe(1);
  });

  it('closes the gate on a clean and complete pass', () => {
    expect(closePassArg('ok', 0)).toBe(1);
  });

  it('leaves the gate open on a clean pass with work left', () => {
    expect(closePassArg('ok', 3)).toBe(0);
  });
});
