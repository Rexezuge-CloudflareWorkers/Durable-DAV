import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface NotificationRow {
  id: string;
  user_email: string;
  repository_id: string | null;
  // Computed `full_name` alias (`repositories` join) — the stored copy was
  // dropped in 0024. Null for global (repo-less) notifications.
  full_name: string | null;
  actor_email: string;
  type: string;
  title: string;
  subject_type: string | null;
  subject_number: number | null;
  is_read: number;
  created_at: number;
}

class NotificationDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async insert(input: {
    id: string;
    userEmail: string;
    repositoryId: string | null;
    actorEmail: string;
    type: string;
    title: string;
    subjectType?: string | null;
    subjectNumber?: number | null;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT OR IGNORE INTO notifications (id, user_email, repository_id, actor_email, type, title, subject_type, subject_number, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
          )
          .bind(
            input.id,
            input.userEmail,
            input.repositoryId,
            input.actorEmail,
            input.type,
            input.title,
            input.subjectType ?? null,
            input.subjectNumber ?? null,
            input.now,
          )
          .run(),
      'insert notification',
    );
  }

  // `full_name` is computed from `repositories` (0024 dropped the stored
  // copy): renames need no cascade here. Null when `repository_id` is null.
  private static readonly FULL_NAME_ALIAS =
    "(SELECT owner || '/' || name FROM repositories WHERE id = notifications.repository_id) AS full_name";

  public async listByUser(
    userEmail: string,
    limit = 50,
    cursor?: string,
    unreadOnly = false,
  ): Promise<{ notifications: NotificationRow[]; nextCursor: string | null }> {
    const decoded = this.decodeCursor<{ created_at: number; id: string }>(cursor);
    const readFilter = unreadOnly ? 'AND is_read = 0' : '';
    const pageSize = limit + 1;
    const result =
      decoded === undefined
        ? await this.database
            .prepare(
              `SELECT notifications.*, ${NotificationDAO.FULL_NAME_ALIAS} FROM notifications WHERE user_email = ? ${readFilter} ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .bind(userEmail, pageSize)
            .all<NotificationRow>()
        : await this.database
            .prepare(
              `SELECT notifications.*, ${NotificationDAO.FULL_NAME_ALIAS} FROM notifications WHERE user_email = ? ${readFilter} AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .bind(userEmail, decoded.created_at, decoded.created_at, decoded.id, pageSize)
            .all<NotificationRow>();
    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return { notifications: page, nextCursor: hasMore && last ? this.encodeCursor({ created_at: last.created_at, id: last.id }) : null };
  }

  public async unreadCount(userEmail: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_email = ? AND is_read = 0')
      .bind(userEmail)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  public async markRead(id: string, userEmail: string): Promise<boolean> {
    const result = await this.withRetry(
      () => this.database.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_email = ?').bind(id, userEmail).run(),
      'mark notification read',
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
  }

  public async markAllRead(userEmail: string): Promise<number> {
    const result = await this.withRetry(
      () => this.database.prepare('UPDATE notifications SET is_read = 1 WHERE user_email = ? AND is_read = 0').bind(userEmail).run(),
      'mark all notifications read',
    );
    return (result.meta as { changes?: number })?.changes ?? 0;
  }

  public async pruneReadOlderThan(cutoff: number, limit: number): Promise<number> {
    const result = await this.database
      .prepare('DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE is_read = 1 AND created_at < ? LIMIT ?)')
      .bind(cutoff, limit)
      .run();
    return (result.meta as { changes?: number })?.changes ?? 0;
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM notifications WHERE repository_id = ?').bind(repositoryId).run(),
      'delete notifications by repo',
    );
  }
}

export { NotificationDAO };
