import { RepositoryDAO } from '@duradav/backend-data/dao';
import type { RepositoryRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { ForbiddenError, NotFoundError } from '@duradav/backend-errors';
import { CryptoUtil, EmailAddress } from '@duradav/shared/utils';
import { INBOX_SHARD, inboxTagForHash, isInboxHash, normalizeChannels, repoShardFor } from '@duradav/shared/realtime';
import { PermissionService } from '../permission/PermissionService';

interface RealtimeServiceEnv {
  DB: D1Queryable;
}

interface RealtimeServiceDeps {
  repositoryDAO?: () => Promise<RepositoryDAO>;
  permissionService?: () => Promise<PermissionService>;
}

interface AuthorizedRepoSubscription {
  shard: string;
  channels: string[];
  repositoryId: string;
  fullName: string;
}

class RealtimeService {
  private readonly deps: Required<RealtimeServiceDeps>;

  constructor(
    private readonly env: RealtimeServiceEnv,
    deps: RealtimeServiceDeps = {},
  ) {
    this.deps = {
      repositoryDAO: () => Promise.resolve(new RepositoryDAO(env.DB)),
      permissionService: () => Promise.resolve(new PermissionService({ DB: env.DB })),
      ...deps,
    };
  }

  public static inboxHashForEmail(email: string): Promise<string> {
    return CryptoUtil.sha256Hex(EmailAddress.normalize(email)).then((hex) => hex.slice(0, 16));
  }

  // Recipient emails → per-user inbox tags for the global shard. Bounded and
  // best-effort: hashing never throws, failures resolve to an empty list.
  public static async hashRecipients(emails: string[], limit = 500): Promise<string[]> {
    const hashes = new Set<string>();
    await Promise.all(
      emails.slice(0, limit).map(async (email) => {
        try {
          hashes.add(await this.inboxHashForEmail(email));
        } catch {
          // ignore — that recipient just misses the live ping
        }
      }),
    );
    return [...hashes];
  }

  public static normalizeRecipientHashes(hashes: unknown, limit = 500): string[] {
    if (!Array.isArray(hashes)) return [];
    const seen = new Set<string>();
    for (const hash of hashes) {
      if (isInboxHash(hash)) seen.add(hash);
      if (seen.size >= limit) break;
    }
    return [...seen];
  }

  // Authorize a ticket request for one repo shard. Private repos hide
  // existence (NotFound when the viewer holds no role); public repos admit
  // anonymous viewers. `presence` is only granted alongside at least one
  // content channel so sockets cannot idle on presence alone.
  public async authorizeRepoChannels(input: {
    viewerEmail: string | null;
    owner: string;
    repo: string;
    channels: unknown;
  }): Promise<AuthorizedRepoSubscription> {
    const repositoryDAO = await this.deps.repositoryDAO();
    const row: RepositoryRow | null = await repositoryDAO.getByOwnerAndName(input.owner, input.repo).catch(() => null);
    if (!row) throw new NotFoundError('Repository not found.');
    const permission = await this.deps.permissionService();
    const role = await permission.getRole(input.viewerEmail, row).catch(() => null);
    if (!role) throw new NotFoundError('Repository not found.');
    const requested = normalizeChannels(input.channels);
    if (requested.length === 0) throw new ForbiddenError('No subscribable channels requested.');
    const fullName = `${row.owner}/${row.name}`;
    // Inbox tags live on the global shard only — never grant them here.
    const channels = requested.filter((channel) => !channel.startsWith('inbox:'));
    if (channels.length === 0) throw new ForbiddenError('No subscribable channels requested.');
    return { shard: repoShardFor(fullName), channels, repositoryId: row.id, fullName };
  }

  public inboxSubscription(emailHash: string): { shard: string; channels: string[] } {
    if (!isInboxHash(emailHash)) throw new ForbiddenError('Invalid inbox subscription.');
    return { shard: INBOX_SHARD, channels: [inboxTagForHash(emailHash)] };
  }
}

export { RealtimeService };
export type { RealtimeServiceDeps, RealtimeServiceEnv, AuthorizedRepoSubscription };
