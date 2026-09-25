/* eslint-disable @typescript-eslint/no-base-to-string -- DO SQLite rows are primitives (TEXT/INTEGER); Record<string, unknown> trips the object-stringification guard. */
import type { DurableSqlStorage } from '@durable-dav/dav-store';
import { getParentPath, getRequestLockTokens, hasAlwaysFalseIfCondition } from '@durable-dav/webdav';

// Lock precondition guard (why: every mutating method duplicated the
// ancestor-walk + token-match logic; one Policy object keeps RFC 4918 §9.10
// semantics in a single testable place).
class DavLockGuard {
  constructor(private readonly sql: DurableSqlStorage) {}

  public assertLock(request: Request, innerPath: string, opts: { ignoreSharedOnTarget?: boolean } = {}): Response | null {
    if (hasAlwaysFalseIfCondition(request)) return new Response('Precondition Failed', { status: 412 });
    const tokens = getRequestLockTokens(request);
    const candidates: string[] = [];
    for (let cur = innerPath; ; cur = getParentPath(cur)) {
      candidates.push(cur);
      if (cur === '') break;
    }
    for (const candidate of candidates) {
      let rows: Array<Record<string, unknown>> = [];
      try {
        const now = Date.now();
        rows = this.sql
          .exec(`SELECT token, scope, depth, expires_at as expiresAt FROM dav_locks WHERE path = ? AND expires_at > ?`, candidate, now)
          .toArray();
      } catch {
        continue;
      }
      const active = rows.filter((r) => {
        const depth = String(r['depth'] ?? '0');
        if (depth !== 'infinity' && candidate !== innerPath) return false;
        if (candidate === innerPath && opts.ignoreSharedOnTarget && String(r['scope']) === 'shared') return false;
        return true;
      });
      if (active.length === 0) continue;
      if (active.every((r) => !tokens.includes(String(r['token'] ?? '')))) {
        return new Response('Locked', { status: 423 });
      }
    }
    return null;
  }

  public activeTokensForPath(innerPath: string, tokens: string[]): string[] {
    try {
      const rows = this.sql.exec(`SELECT token FROM dav_locks WHERE path = ? AND expires_at > ?`, innerPath, Date.now()).toArray();
      return rows.map((r) => String(r['token'] ?? '')).filter((t) => t !== '' && !tokens.includes(t));
    } catch {
      return [];
    }
  }
}

export { DavLockGuard };
