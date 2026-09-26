/* eslint-disable @typescript-eslint/no-base-to-string -- DO SQLite rows are primitives (TEXT/INTEGER); Record<string, unknown> trips the object-stringification guard. */
import type { DurableSqlStorage } from '@durable-dav/dav-store';
import { getParentPath, getRequestLockTokens, hasAlwaysFalseIfCondition, normalizeLockToken } from '@durable-dav/webdav';

// Lock precondition guard (why: every mutating method duplicated the
// ancestor-walk + token-match logic; one Policy object keeps RFC 4918 §9.10
// semantics in a single testable place).
class DavLockGuard {
  constructor(private readonly sql: DurableSqlStorage) {}

  // Ancestor chain of `innerPath`, nearest first, root last. Bounded so a
  // pathological deep path cannot drive an unbounded SQL walk.
  private static ancestorsOf(innerPath: string): string[] {
    const out: string[] = [];
    let cur = innerPath;
    for (;;) {
      out.push(cur);
      if (cur === '' || out.length >= 256) break;
      cur = getParentPath(cur);
    }
    return out;
  }

  /**
   * All unexpired locks on `innerPath` or any ancestor, as
   * `{ path, token, scope, depth }`. A single query rather than one per
   * ancestor level: the old shape issued depth-many round trips through the
   * storage layer on every write.
   *
   * Throws if the lookup fails. A failed lookup must never be reported as
   * "unlocked" — that silently downgraded Class 2 to Class 1.
   */
  private locksAffecting(innerPath: string): Array<{ path: string; token: string; scope: string; depth: string }> {
    const ancestors = DavLockGuard.ancestorsOf(innerPath);
    const placeholders = ancestors.map(() => '?').join(', ');
    const rows = this.sql
      .exec(
        `SELECT path, token, scope, depth FROM dav_locks WHERE path IN (${placeholders}) AND expires_at > ?`,
        ...ancestors,
        Date.now(),
      )
      .toArray();
    return rows.map((row) => ({
      path: String(row['path'] ?? ''),
      token: String(row['token'] ?? ''),
      scope: String(row['scope'] ?? ''),
      depth: String(row['depth'] ?? '0'),
    }));
  }

  public assertLock(request: Request, innerPath: string, opts: { ignoreSharedOnTarget?: boolean } = {}): Response | null {
    if (hasAlwaysFalseIfCondition(request)) return new Response('Precondition Failed', { status: 412 });
    // Normalize both sides (why: `If`/`Lock-Token` headers arrive as
    // `<opaquelocktoken:…>`/`urn:uuid:…` while `dav_locks.token` stores the
    // raw value; raw comparison never matched and every locked write 423'd).
    const tokens = new Set(getRequestLockTokens(request).map((t) => normalizeLockToken(t)));

    const blocking = this.locksAffecting(innerPath).filter((lock) => {
      // A depth-0 lock only covers its own node; an ancestor's depth-0 lock
      // does not reach descendants.
      if (lock.depth !== 'infinity' && lock.path !== innerPath) return false;
      const sharedOnTarget = lock.path === innerPath && opts.ignoreSharedOnTarget === true && lock.scope === 'shared';
      return !sharedOnTarget && !tokens.has(normalizeLockToken(lock.token));
    });

    return blocking.length > 0 ? new Response('Locked', { status: 423 }) : null;
  }

  /**
   * Lock tokens on `innerPath` held by *other* clients. Used by recursive
   * DELETE to refuse removing locked descendants (RFC 4918 §9.6.1 / §9.10.4).
   * Throws on lookup failure — an empty result must mean "genuinely unlocked".
   */
  public activeTokensForPath(innerPath: string, tokens: string[]): string[] {
    const normalized = new Set(tokens.map((t) => normalizeLockToken(t)));
    return this.locksAffecting(innerPath)
      .filter((lock) => lock.path === innerPath)
      .map((lock) => lock.token)
      .filter((token) => token !== '' && !normalized.has(normalizeLockToken(token)));
  }
}

export { DavLockGuard };
