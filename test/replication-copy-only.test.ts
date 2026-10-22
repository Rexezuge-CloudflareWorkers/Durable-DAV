import { describe, expect, it } from 'vitest';
import { buildReplicationPlan } from '@durable-dav/backend-services/replication';
import type { PlanBase, PlanSide, ReplicationDecision } from '@durable-dav/backend-services/replication';

/**
 * `copy-only`: the mode where this bucket is the sole writer and the remote is a
 * mirror.
 *
 * The invariant this file exists to protect is one sentence: **a `copy-only` plan
 * only ever contains `push`, `agree`, `delete-remote` or `forget`.** Not "rarely",
 * not "except in a conflict" — those four and nothing else. Every other decision
 * either writes to the local side (`pull`, `delete-local`, `pull-and-preserve`),
 * writes to *both* sides (`keep-both`), or asks a question the mode has already
 * answered (`compare-content`).
 *
 * The second invariant is the one the reported bug was about: **a `copy-only` plan
 * never destroys the source.** The remote missing a file means the *mirror* has a
 * gap, and the gap is filled by pushing the local copy — not by deleting it. The
 * rule that used to apply here read "absent from the remote" as "deleted on the
 * remote" and propagated the deletion the other way, so a missing mirror file
 * destroyed the only copy of it while the run reported success.
 *
 * The exhaustive sweep at the end is what keeps the first invariant true as the
 * planner grows: it runs every path through every combination of the three views
 * and both absence settings, and classifies every decision that comes out. A new
 * decision kind has to be classified here to pass, which is the point.
 */

const NOW = 1_700_000_000_000;

/**
 * The decisions a `copy-only` plan may contain.
 *
 * Anything not on this list is a bug in this mode: it either moves bytes in a
 * direction this bucket is not authoritative for, or destroys something the owner
 * still has.
 */
const ALLOWED = new Set(['push', 'agree', 'delete-remote', 'forget']);

function side(path: string, overrides: Partial<PlanSide> = {}): PlanSide {
  return { path, isCollection: false, etag: `"${path}-v1"`, mtime: 1000, size: 10, contentType: 'text/plain', ...overrides };
}

function changed(path: string, overrides: Partial<PlanSide> = {}): PlanSide {
  return side(path, { etag: `"${path}-v2"`, mtime: 2000, ...overrides });
}

function collection(path: string): PlanSide {
  return side(path, { isCollection: true, etag: null, size: null });
}

function base(path: string, overrides: Partial<PlanBase> = {}): PlanBase {
  return {
    path,
    isCollection: false,
    localEtag: `"${path}-v1"`,
    localMtime: 1000,
    localSize: 10,
    remoteEtag: `"${path}-v1"`,
    remoteMtime: 1000,
    remoteSize: 10,
    contentType: 'text/plain',
    ...overrides,
  };
}

function kinds(decisions: readonly ReplicationDecision[]): string[] {
  return decisions.map((decision) => `${decision.kind} ${decision.path}`);
}

function plan(input: {
  local?: PlanSide[];
  remote?: PlanSide[];
  base?: PlanBase[];
  trustAbsences?: boolean;
  hashOnAmbiguous?: boolean;
  mirrorDeletions?: boolean;
}) {
  return buildReplicationPlan({
    mode: 'copy-only',
    local: input.local ?? [],
    remote: input.remote ?? [],
    base: input.base ?? [],
    trustAbsences: input.trustAbsences ?? true,
    hashOnAmbiguous: input.hashOnAmbiguous,
    mirrorDeletions: input.mirrorDeletions,
    now: NOW,
  });
}

describe('copy-only — the remote is a mirror of this bucket', () => {
  it('pushes a file the remote has never seen', () => {
    const result = plan({ local: [side('a.txt')] });
    expect(kinds(result.decisions)).toEqual(['push a.txt']);
  });

  it('pushes a file the remote has lost, rather than deleting the local copy', () => {
    // The reported bug, in the planner's own terms: the base says both sides had
    // it, the remote no longer does, and the plan used to read that as "the
    // remote deleted it" and delete the local file. The mirror had a gap; the
    // answer is to fill it.
    const result = plan({ local: [side('a.txt')], base: [base('a.txt')] });
    expect(kinds(result.decisions)).toEqual(['push a.txt']);
  });

  it('never deletes the local copy of a file the remote lacks', () => {
    const result = plan({ local: [side('a.txt')], base: [base('a.txt')] });
    expect(result.decisions.some((decision) => decision.kind === 'delete-local')).toBe(false);
  });

  it('removes the remote copy of a file deleted here', () => {
    // The one deletion this mode propagates: the local side is the authority, so
    // a deletion here has to reach the mirror.
    const result = plan({ remote: [side('a.txt')], base: [base('a.txt')] });
    expect(kinds(result.decisions)).toEqual(['delete-remote a.txt']);
  });

  it('repairs a mirror that drifted', () => {
    // The remote changed on its own. The local side is the authority, so the
    // local version goes back over it — and the run does not record the remote's
    // diverged validators as the new base, which is what made the drift
    // permanent.
    const result = plan({ local: [side('a.txt')], remote: [changed('a.txt')], base: [base('a.txt')] });
    expect(kinds(result.decisions)).toEqual(['push a.txt']);
    expect(result.conflicts).toEqual([]);
  });

  it('does not import a remote-only file', () => {
    // The remote holds something this bucket never had and never sent. It is not
    // ours to delete — the target bucket may hold other people's content — and it
    // is certainly not ours to import.
    const result = plan({ remote: [side('theirs.txt')] });
    expect(result.decisions).toEqual([]);
  });

  it('pushes the local version when both sides created the file', () => {
    const result = plan({ local: [side('a.txt')], remote: [changed('a.txt')] });
    expect(kinds(result.decisions)).toEqual(['push a.txt']);
  });

  it('records agreement when neither side changed', () => {
    const result = plan({ local: [side('a.txt')], remote: [side('a.txt')], base: [base('a.txt')] });
    expect(kinds(result.decisions)).toEqual(['agree a.txt']);
    expect(result.conflicts).toEqual([]);
  });

  it('forgets a path that reached neither side', () => {
    const result = plan({ base: [base('a.txt')] });
    expect(kinds(result.decisions)).toEqual(['forget a.txt']);
  });

  it('holds back every absence-based decision on an untrusted pass', () => {
    // A failed listing makes the remote look empty. Acting on that would delete
    // the owner's files — the one thing this mode must never do to its source.
    const result = plan({ local: [side('a.txt')], base: [base('a.txt')], trustAbsences: false });
    expect(result.decisions).toEqual([]);
    expect(result.deferredPaths).toEqual(['a.txt']);
  });

  it('orders a collection before the files inside it', () => {
    const result = plan({
      local: [collection('dir'), side('dir/a.txt')],
      remote: [],
      base: [],
    });
    expect(kinds(result.decisions)).toEqual(['push dir', 'push dir/a.txt']);
  });

  it('never consults the content hash', () => {
    // The hash exists to decide *which* side wins. This mode has already decided:
    // the local side does. So the comparison is skipped rather than performed and
    // then overruled.
    const result = plan({ local: [side('a.txt')], remote: [changed('a.txt')], base: [base('a.txt')], hashOnAmbiguous: true });
    expect(kinds(result.decisions)).toEqual(['push a.txt']);
    expect(result.decisions.some((decision) => decision.kind === 'compare-content')).toBe(false);
  });
});

describe('copy-only — every shape, exhaustively', () => {
  it('emits only mirror decisions across the full state matrix', () => {
    // Each path is run through all eight presence combinations (local × remote ×
    // base) with and without the absence gate and the hash flag, and every
    // resulting plan is checked against the invariant rather than against an
    // expected list — so a new decision kind has to be classified here to pass.
    const variants: PlanSide[] = [side('f.txt'), changed('f.txt'), collection('f.txt')];
    const bases: Array<PlanBase | undefined> = [undefined, base('f.txt'), base('f.txt', { remoteEtag: '"f.txt-v0"', remoteMtime: 900 })];

    const offenders: string[] = [];
    for (const local of [undefined, ...variants]) {
      for (const remote of [undefined, ...variants]) {
        for (const b of bases) {
          for (const trustAbsences of [true, false]) {
            for (const hashOnAmbiguous of [true, false]) {
              const result = buildReplicationPlan({
                mode: 'copy-only',
                local: local === undefined ? [] : [local],
                remote: remote === undefined ? [] : [remote],
                base: b === undefined ? [] : [b],
                trustAbsences,
                hashOnAmbiguous,
                now: NOW,
              });
              for (const decision of result.decisions) {
                if (!ALLOWED.has(decision.kind)) {
                  offenders.push(`${decision.kind} ${decision.path} (trust=${trustAbsences} hash=${hashOnAmbiguous})`);
                }
              }
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never proposes a deletion of the local side, in any shape', () => {
    // The second invariant, checked on its own: the source is never destroyed.
    const variants: PlanSide[] = [side('f.txt'), changed('f.txt'), collection('f.txt')];
    const bases: Array<PlanBase | undefined> = [undefined, base('f.txt'), base('f.txt', { remoteEtag: '"f.txt-v0"', remoteMtime: 900 })];

    const offenders: string[] = [];
    for (const local of [undefined, ...variants]) {
      for (const remote of [undefined, ...variants]) {
        for (const b of bases) {
          for (const trustAbsences of [true, false]) {
            const result = buildReplicationPlan({
              mode: 'copy-only',
              local: local === undefined ? [] : [local],
              remote: remote === undefined ? [] : [remote],
              base: b === undefined ? [] : [b],
              trustAbsences,
              now: NOW,
            });
            for (const decision of result.decisions) {
              if (decision.kind === 'delete-local') offenders.push(`${decision.kind} ${decision.path}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the other modes are unchanged by copy-only', () => {
  it('still deletes the local copy of a file the remote lacks in the two-way modes', () => {
    // The two-way modes propagate a deletion in whichever direction it happened,
    // and that is correct: the remote having lost a file is not evidence about
    // the local one.
    for (const mode of ['keep-both', 'sync'] as const) {
      const result = buildReplicationPlan({ mode, local: [side('a.txt')], remote: [], base: [base('a.txt')], trustAbsences: true });
      expect(kinds(result.decisions)).toEqual(['delete-local a.txt']);
    }
  });

  it('still imports a remote-only change in the two-way modes', () => {
    for (const mode of ['keep-both', 'sync'] as const) {
      const result = buildReplicationPlan({
        mode,
        local: [side('a.txt')],
        remote: [changed('a.txt')],
        base: [base('a.txt')],
        trustAbsences: true,
      });
      expect(kinds(result.decisions)).toEqual(['pull a.txt']);
    }
  });

  it('still keeps both copies of a genuine conflict in keep-both', () => {
    const result = buildReplicationPlan({
      mode: 'keep-both',
      local: [changed('a.txt')],
      remote: [changed('a.txt', { etag: '"a-v3"', mtime: 3000 })],
      base: [base('a.txt')],
      trustAbsences: true,
    });
    expect(result.decisions[0]?.kind).toBe('keep-both');
  });
});
