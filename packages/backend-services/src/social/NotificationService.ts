import { NotificationDAO, RepositoryDAO, UserDAO, WatchDAO } from '@duradav/backend-data/dao';
import type { NotificationRow, RepositoryRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { EmailAddress, TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { PermissionService } from '../permission/PermissionService';

interface NotificationServiceEnv {
  DB: D1Queryable;
}

interface NotificationServiceDeps {
  notificationDAO?: () => Promise<NotificationDAO>;
  watchDAO?: () => Promise<WatchDAO>;
  userDAO?: () => Promise<UserDAO>;
  repositoryDAO?: () => Promise<RepositoryDAO>;
  permissionService?: () => Promise<PermissionService>;
}

interface FanOutInput {
  repositoryId: string | null;
  fullName: string;
  actorEmail: string;
  type: string;
  title: string;
  subjectType?: string | null;
  subjectNumber?: number | null;
  participantEmails?: string[];
  mentionUsernames?: string[];
}

const MENTION_RE = /@([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)/gi;
const MAX_FANOUT_RECIPIENTS = 500;

function parseMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

class NotificationService {
  private readonly deps: Required<NotificationServiceDeps>;

  constructor(
    private readonly env: NotificationServiceEnv,
    deps: NotificationServiceDeps = {},
  ) {
    this.deps = {
      notificationDAO: () => Promise.resolve(new NotificationDAO(env.DB)),
      watchDAO: () => Promise.resolve(new WatchDAO(env.DB)),
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      repositoryDAO: () => Promise.resolve(new RepositoryDAO(env.DB)),
      permissionService: () => Promise.resolve(new PermissionService({ DB: env.DB })),
      ...deps,
    };
  }

  public static parseMentions(text: string | null | undefined): string[] {
    return parseMentions(text);
  }

  private permission(): Promise<PermissionService> {
    return this.deps.permissionService();
  }

  public async resolveMentionEmails(usernames: string[]): Promise<string[]> {
    if (usernames.length === 0) return [];
    const userDAO = await this.deps.userDAO();
    const emails: string[] = [];
    const candidates = usernames.slice(0, 50);
    for (const username of candidates) {
      try {
        const user = await userDAO.getByUsernameCi(EmailAddress.normalize(username));
        if (user) emails.push(EmailAddress.normalize(user.email));
      } catch {
        // ignore — missing users table or unknown username
      }
    }
    return emails;
  }

  // Fan out one event to watchers + participants + @mentions, minus the
  // actor, keeping only recipients that still hold read+ on the repo.
  // Private repos therefore never leak via notifications. Returns the
  // recipient emails so callers can also ping live-update subscribers.
  public async fanOut(input: FanOutInput): Promise<{ notified: number; recipients: string[] }> {
    const actor = EmailAddress.normalize(input.actorEmail);
    const candidates = new Set<string>();
    if (input.repositoryId) {
      try {
        const watchDAO = await this.deps.watchDAO();
        const watchers = await watchDAO.listWatchers(input.repositoryId, MAX_FANOUT_RECIPIENTS);
        for (const watcher of watchers) {
          candidates.add(EmailAddress.normalize(watcher));
        }
      } catch {
        // ignore — legacy DBs without repo_watches
      }
    }
    const participants = input.participantEmails ?? [];
    for (const email of participants) {
      candidates.add(email.toLowerCase());
    }
    const mentionUsernames = input.mentionUsernames ?? [];
    const mentioned = await this.resolveMentionEmails(mentionUsernames);
    for (const email of mentioned) {
      candidates.add(email);
    }
    candidates.delete(actor);
    if (candidates.size === 0) return { notified: 0, recipients: [] };

    let repo: RepositoryRow | null = null;
    if (input.repositoryId) {
      try {
        const repositoryDAO = await this.deps.repositoryDAO();
        repo = await repositoryDAO.getById(input.repositoryId);
      } catch {
        repo = null;
      }
    }

    const dao = await this.deps.notificationDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const recipients = [...candidates].slice(0, MAX_FANOUT_RECIPIENTS);
    const delivered: string[] = [];
    let notified = 0;
    for (const recipient of recipients) {
      if (repo) {
        try {
          const permission = await this.permission();
          const role = await permission.getRole(recipient, repo);
          if (!role) continue;
        } catch {
          continue;
        }
      }
      await dao
        .insert({
          id: UUIDUtil.getRandomUUID(),
          userEmail: recipient,
          repositoryId: input.repositoryId,
          actorEmail: actor,
          type: input.type,
          title: input.title.slice(0, 200),
          subjectType: input.subjectType ?? null,
          subjectNumber: input.subjectNumber ?? null,
          now,
        })
        .catch(() => undefined);
      notified += 1;
      delivered.push(recipient);
    }
    return { notified, recipients: delivered };
  }

  public async listByUser(
    userEmail: string,
    limit = 50,
    cursor?: string,
    unreadOnly = false,
  ): Promise<{ notifications: NotificationRow[]; nextCursor: string | null }> {
    const dao = await this.deps.notificationDAO();
    return dao.listByUser(userEmail.toLowerCase(), Math.min(Math.max(limit, 1), 100), cursor, unreadOnly);
  }

  public async unreadCount(userEmail: string): Promise<number> {
    const dao = await this.deps.notificationDAO();
    return dao.unreadCount(userEmail.toLowerCase());
  }

  public async markRead(id: string, userEmail: string): Promise<boolean> {
    const dao = await this.deps.notificationDAO();
    return dao.markRead(id, userEmail.toLowerCase());
  }

  public async markAllRead(userEmail: string): Promise<number> {
    const dao = await this.deps.notificationDAO();
    return dao.markAllRead(userEmail.toLowerCase());
  }

  public async pruneReadOlderThan(cutoff: number, limit: number): Promise<number> {
    const dao = await this.deps.notificationDAO();
    return dao.pruneReadOlderThan(cutoff, limit);
  }
}

export { NotificationService, MAX_FANOUT_RECIPIENTS };
export type { FanOutInput, NotificationServiceDeps, NotificationServiceEnv };
