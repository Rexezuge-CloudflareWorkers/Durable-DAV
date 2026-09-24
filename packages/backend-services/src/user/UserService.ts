import {
  EventDAO,
  IssueDAO,
  NamespaceDAO,
  NotificationDAO,
  OrganizationDAO,
  PullRequestDAO,
  RepositoryDAO,
  UserDAO,
  WebhookDAO,
} from '@duradav/backend-data/dao';
import type { UserRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { isReservedNamespaceName } from '@duradav/shared/constants';
import { TimestampUtil } from '@duradav/shared/utils';
import { cascadeOwnerRepos } from '../repo/repoRenameCascade';

interface UserServiceEnv {
  DB: D1Queryable;
}

interface UserServiceDeps {
  userDAO?: () => Promise<UserDAO>;
  namespaceDAO?: () => Promise<NamespaceDAO>;
  organizationDAO?: () => Promise<OrganizationDAO>;
  repositoryDAO?: () => Promise<RepositoryDAO>;
  issueDAO?: () => Promise<IssueDAO>;
  pullRequestDAO?: () => Promise<PullRequestDAO>;
  eventDAO?: () => Promise<EventDAO>;
  notificationDAO?: () => Promise<NotificationDAO>;
  webhookDAO?: () => Promise<WebhookDAO>;
}

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;

function deriveUsernameCandidate(email: string): string {
  const prefix = email.split('@', 1)[0].toLowerCase();
  let sanitized = '';
  for (const ch of prefix) {
    sanitized += ch === '-' || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') ? ch : '-';
  }
  sanitized = sanitized.replaceAll(/-{2,}/g, '-');
  let start = 0;
  while (start < sanitized.length && sanitized[start] === '-') start += 1;
  let end = sanitized.length;
  while (end > start && sanitized[end - 1] === '-') end -= 1;
  sanitized = sanitized.slice(start, end);
  if (USERNAME_RE.test(sanitized)) return sanitized;
  let alnum = '';
  for (const ch of sanitized) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) alnum += ch;
  }
  if (alnum.length > 0) return alnum.slice(0, 39);
  return 'user';
}

class UserService {
  private readonly deps: Required<UserServiceDeps>;

  constructor(
    private readonly env: UserServiceEnv,
    deps: UserServiceDeps = {},
  ) {
    this.deps = {
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      namespaceDAO: () => Promise.resolve(new NamespaceDAO(env.DB)),
      organizationDAO: () => Promise.resolve(new OrganizationDAO(env.DB)),
      repositoryDAO: () => Promise.resolve(new RepositoryDAO(env.DB)),
      issueDAO: () => Promise.resolve(new IssueDAO(env.DB)),
      pullRequestDAO: () => Promise.resolve(new PullRequestDAO(env.DB)),
      eventDAO: () => Promise.resolve(new EventDAO(env.DB)),
      notificationDAO: () => Promise.resolve(new NotificationDAO(env.DB)),
      webhookDAO: () =>
        Promise.reject<WebhookDAO>(new Error('UserService requires an injected webhookDAO outside request scope.')),
      ...deps,
    };
  }

  public static validateUsername(username: string): void {
    if (!USERNAME_RE.test(username)) {
      throw new BadRequestError('Invalid username');
    }
    if (isReservedNamespaceName(username)) {
      throw new BadRequestError('Username is reserved');
    }
  }

  public async upsertUser(email: string): Promise<void> {
    const normalized = email.toLowerCase();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const dao = await this.deps.userDAO();
    await dao.upsertUser(normalized, now);
    // Best-effort username bootstrap: existing rows keep their handle.
    try {
      const existing = await dao.getByEmail(normalized);
      if (existing?.username) return;
      const base = deriveUsernameCandidate(normalized);
      const handle = await this.findFreeUsername(base);
      await dao.ensureUsername(normalized, handle, now);
      try {
        const ns = await this.deps.namespaceDAO();
        await ns.claimIgnore({ usernameCi: handle.toLowerCase(), kind: 'user', userEmail: normalized, now });
      } catch {
        // namespaces table may not exist on old DBs — username column is authoritative there
      }
    } catch {
      // Never fail authentication because of profile bootstrap.
    }
  }

  private async findFreeUsername(base: string): Promise<string> {
    const dao = await this.deps.userDAO();
    let candidate = base;
    for (let attempt = 0; attempt < 50; attempt++) {
      const ci = candidate.toLowerCase();
      let taken = isReservedNamespaceName(ci);
      try {
        const ns = await this.deps.namespaceDAO();
        taken ||= await ns.isTaken(ci);
      } catch {
        // keep reserved-derived taken value
      }
      if (!taken) {
        try {
          const [userMatch, orgMatch] = await Promise.all([
            dao.getByUsernameCi(ci),
            this.deps.organizationDAO().then((o) => o.getByUsernameCi(ci)),
          ]);
          taken = Boolean(userMatch ?? orgMatch);
        } catch {
          // ignore — registry check above stands
        }
      }
      if (!taken) return candidate;
      candidate = `${base}-${attempt + 1}`;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  public async getProfileByEmail(email: string): Promise<{ email: string; username: string | null }> {
    const dao = await this.deps.userDAO();
    const row = await dao.getByEmail(email.toLowerCase());
    if (!row) throw new NotFoundError('User not found');
    return { email: row.email, username: row.username ?? null };
  }

  public async getByUsername(username: string): Promise<UserRow | null> {
    const dao = await this.deps.userDAO();
    try {
      return await dao.getByUsernameCi(username.toLowerCase());
    } catch {
      return null;
    }
  }

  public async renameUsername(email: string, newUsername: string): Promise<{ email: string; username: string }> {
    const handle = newUsername.trim();
    UserService.validateUsername(handle);
    const handleCi = handle.toLowerCase();
    const normalized = email.toLowerCase();
    const dao = await this.deps.userDAO();
    const existing = await dao.getByEmail(normalized);
    if (!existing) throw new NotFoundError('User not found');
    if (existing.username?.toLowerCase() === handleCi) return { email: existing.email, username: existing.username };
    let taken = false;
    try {
      const nsDao = await this.deps.namespaceDAO();
      let selfOwned = false;
      let otherOwned = false;
      try {
        if (typeof nsDao.get === 'function') {
          const row = await nsDao.get(handleCi);
          if (row) {
            if (row.kind === 'user' && row.user_email?.toLowerCase() === normalized) {
              selfOwned = true;
            } else {
              otherOwned = true;
            }
          }
        }
      } catch {
        // get failed (legacy DB) — fall through to isTaken below.
      }
      if (otherOwned) {
        taken = true;
      } else if (!selfOwned) {
        try {
          taken = await nsDao.isTaken(handleCi);
        } catch {
          taken = false;
        }
      }
      // selfOwned → taken stays false so the owner can reclaim a
      // previously renamed-away handle; the users/orgs check below still
      // blocks if another account actively holds the handle.
    } catch {
      taken = false;
    }
    if (!taken) {
      try {
        const orgDao = await this.deps.organizationDAO();
        const [userMatch, orgMatch] = await Promise.all([dao.getByUsernameCi(handleCi), orgDao.getByUsernameCi(handleCi)]);
        const userTaken = Boolean(userMatch && userMatch.email.toLowerCase() !== normalized);
        taken = Boolean(userTaken || orgMatch);
      } catch {
        // ignore
      }
    }
    if (taken) throw new BadRequestError('Username is already taken');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const oldCi = existing.username?.toLowerCase();
    // Claim-first ordering narrows the rename TOCTOU: claim the new name
    // before mutating `users`, so a concurrent claimer wins with a clean
    // abort instead of leaving `users.username` renamed without a namespace.
    // If the subsequent update fails, best-effort release the new claim.
    // Legacy DBs without a namespaces table fall back to `users.username`
    // as authoritative (claim/isTaken both throw there).
    let namespaceClaimed = false;
    let legacyNamespaces = false;
    let claimedFresh = false;
    try {
      const ns = await this.deps.namespaceDAO();
      await ns.claim({ usernameCi: handleCi, kind: 'user', userEmail: normalized, now });
      namespaceClaimed = true;
      claimedFresh = true;
    } catch (error) {
      // Claim race or legacy-DB error: if the existing claim belongs to self
      // (rename-back after a failed DO move), treat as success so rollback
      // never orphans the user. Otherwise report taken cleanly.
      try {
        const nsDao = await this.deps.namespaceDAO();
        const row = await nsDao.get(handleCi).catch(() => null);
        if (row && row.user_email?.toLowerCase() === normalized) {
          namespaceClaimed = true;
          claimedFresh = false;
        } else {
          if (await nsDao.isTaken(handleCi)) throw new BadRequestError('Username is already taken');
        }
      } catch (inner) {
        if (inner instanceof BadRequestError) throw inner;
        // isTaken itself threw → namespaces table missing → legacy path.
        legacyNamespaces = true;
      }
      if (!legacyNamespaces && !namespaceClaimed) throw error instanceof Error ? error : new BadRequestError('Username is already taken');
    }
    try {
      await dao.setUsername(normalized, handle, now);
    } catch (error) {
      if (claimedFresh) {
        try {
          const ns = await this.deps.namespaceDAO();
          await ns.release(handleCi);
        } catch {
          // ignore rollback failure
        }
      }
      throw error;
    }
    // Hardening: old names stay reserved (no immediate release) so a
    // concurrent attacker cannot hijack the freed handle in the window
    // between D1 rename and DO move. Renamed-away handles remain taken
    // for other accounts, but the owning email may reclaim them (rename
    // back / rollback after a failed DO move). A future tombstone/GC
    // migration can free them after a grace period.
    // Simple rename: cascade owner on user-owned repos. Display names are
    // computed from `repositories`, so no sidecar updates are needed.
    if (oldCi) {
      try {
        await cascadeOwnerRepos(
          { repositoryDAO: this.deps.repositoryDAO },
          { oldOwnerCi: oldCi, newOwner: handle, now },
        );
      } catch {
        // ignore
      }
    }
    return { email: normalized, username: handle };
  }
}

export { UserService };
export type { UserServiceDeps, UserServiceEnv };
