import {
  DavVolumeDAO,
  NamespaceDAO,
  UserDAO,
} from '@durable-dav/backend-data/dao';
import type { UserRow } from '@durable-dav/backend-data/dao';
import type { D1Queryable } from '@durable-dav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@durable-dav/backend-errors';
import { isReservedNamespaceName } from '@durable-dav/shared/constants';
import { TimestampUtil } from '@durable-dav/shared/utils';
import { cascadeOwnerVolumes } from './volumeRenameCascade';

interface UserServiceEnv {
  DB: D1Queryable;
}

interface UserServiceDeps {
  userDAO?: () => Promise<UserDAO>;
  namespaceDAO?: () => Promise<NamespaceDAO>;
  volumeDAO?: () => Promise<Pick<DavVolumeDAO, 'renameOwner'>>;
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
  return alnum.length > 0 ? alnum.slice(0, 39) : 'user';
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
      volumeDAO: () => Promise.resolve(new DavVolumeDAO(env.DB)),
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
          const userMatch = await dao.getByUsernameCi(ci);
          taken = Boolean(userMatch);
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
        // get failed — fall through to isTaken below.
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
    } catch {
      taken = false;
    }
    if (!taken) {
      try {
        const userMatch = await dao.getByUsernameCi(handleCi);
        taken = Boolean(userMatch && userMatch.email.toLowerCase() !== normalized);
      } catch {
        // ignore
      }
    }
    if (taken) throw new BadRequestError('Username is already taken');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    // Claim-first ordering narrows the rename TOCTOU: claim the new name
    // before mutating `users`, so a concurrent claimer wins with a clean
    // abort instead of leaving `users.username` renamed without a namespace.
    // If the subsequent update fails, best-effort release the new claim.
    let namespaceClaimed = false;
    let claimedFresh = false;
    let legacyNamespaces = false;
    try {
      const ns = await this.deps.namespaceDAO();
      await ns.claim({ usernameCi: handleCi, kind: 'user', userEmail: normalized, now });
      namespaceClaimed = true;
      claimedFresh = true;
    } catch (error) {
      // Claim race: if the existing claim belongs to self (rename-back after
      // a failure), treat as success. Otherwise report taken cleanly.
      // Legacy DBs without a namespaces table fall back to `users.username`
      // as authoritative (claim/isTaken both throw there).
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
    const oldCi = existing.username?.toLowerCase();
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
    // Old names stay reserved (no immediate release) so a concurrent
    // attacker cannot hijack the freed handle in the window between D1
    // rename and propagation. Renamed-away handles remain taken for other
    // accounts, but the owning email may reclaim them.
    // Simple rename: cascade owner on user-owned volumes. `owner_email` is
    // the stable key, so only `owner`/`owner_ci` move; DO isolate moves stay
    // in the API layer (route-level snapshots).
    if (oldCi) {
      try {
        await cascadeOwnerVolumes({ volumeDAO: this.deps.volumeDAO }, { oldOwnerCi: oldCi, newOwner: handle, now });
      } catch {
        // ignore
      }
    }
    return { email: normalized, username: handle };
  }
}

export { UserService };
export type { UserServiceDeps, UserServiceEnv };
