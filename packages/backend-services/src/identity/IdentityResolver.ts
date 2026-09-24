import { UserDAO } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { DatabaseError } from '@duradav/backend-errors';
import { isValidEmailFormat } from '@duradav/shared/utils';

interface IdentityResolverEnv {
  DB: D1Queryable;
}

interface IdentityResolverDeps {
  userDAO?: () => Promise<UserDAO>;
}

const GHOST_USERNAME = 'ghost';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Email is the stable unique identifier (mutable usernames would orphan
// history on rename). This resolver maps stored emails to current usernames
// at read time only — D1 rows keep `*_email` columns untouched.
class IdentityResolver {
  private readonly deps: Required<IdentityResolverDeps>;

  constructor(
    private readonly env: IdentityResolverEnv,
    deps: IdentityResolverDeps = {},
  ) {
    this.deps = {
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      ...deps,
    };
  }

  public static ghost(): string {
    return GHOST_USERNAME;
  }

  public async resolveUsernames(emails: unknown[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const raw of emails) {
      if (typeof raw !== 'string' || !raw) continue;
      const key = normalizeEmail(raw);
      if (!isValidEmailFormat(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(key);
    }
    if (deduped.length === 0) return out;
    // Fail closed on outage (breaking change): a DAO throw means the identity
    // store is unavailable, which must surface as 500 — not as `ghost` for
    // every key. `ghost` is reserved for genuinely unknown/deleted users.
    // Callers (IdentityPresenter.usernameMap) propagate so attribution is
    // never silently rewritten during an outage.
    const dao = await this.deps.userDAO().catch((error) => {
      throw error instanceof DatabaseError
        ? error
        : new DatabaseError(`Failed to resolve usernames: ${error instanceof Error ? error.message : String(error)}`);
    });
    let rows: Array<{ email?: string | null; username?: string | null }>;
    try {
      rows = await dao.getByEmails(deduped);
    } catch (error) {
      throw error instanceof DatabaseError
        ? error
        : new DatabaseError(`Failed to resolve usernames: ${error instanceof Error ? error.message : String(error)}`);
    }
    const byEmail = new Map<string, string>();
    for (const row of rows) {
      const username = row.username?.trim();
      if (username && row.email) byEmail.set(normalizeEmail(row.email), username);
    }
    for (const key of deduped) {
      out.set(key, byEmail.get(key) ?? GHOST_USERNAME);
    }
    return out;
  }

  public async resolveUsername(email: string): Promise<string> {
    const key = normalizeEmail(email);
    if (!key) return GHOST_USERNAME;
    const map = await this.resolveUsernames([key]);
    return map.get(key) ?? GHOST_USERNAME;
  }

  // Accepts `username` or `email` (for filters like `?user=` / `?userEmail=`).
  // Returns the canonical stored email, or null when unknown.
  public async resolveEmail(usernameOrEmail: unknown): Promise<string | null> {
    if (typeof usernameOrEmail !== 'string') return null;
    const raw = usernameOrEmail.trim();
    if (!raw || raw.length > 254) return null;
    if (raw.includes('@')) {
      const normalized = normalizeEmail(raw);
      if (!isValidEmailFormat(normalized)) return null;
      return normalized;
    }
    try {
      const dao = await this.deps.userDAO();
      const row = await dao.getByUsernameCi(raw.toLowerCase());
      return row ? normalizeEmail(row.email) : null;
    } catch {
      return null;
    }
  }
}

export { IdentityResolver, GHOST_USERNAME };
export type { IdentityResolverDeps, IdentityResolverEnv };
