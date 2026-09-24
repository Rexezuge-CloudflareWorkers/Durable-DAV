import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

interface WebhookDeliveryRow {
  id: string;
  hook_id: string;
  repository_id: string;
  event: string;
  event_id: string | null;
  payload: string;
  status: string;
  attempts: number;
  next_retry_at: number;
  last_http_status: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

class WebhookDeliveryDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async enqueue(input: {
    id: string;
    hookId: string;
    repositoryId: string;
    event: string;
    eventId?: string | null;
    payload?: string;
    nextRetryAt: number;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            "INSERT INTO webhook_deliveries (id, hook_id, repository_id, event, event_id, payload, status, attempts, next_retry_at, last_http_status, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)",
          )
          .bind(
            input.id,
            input.hookId,
            input.repositoryId,
            input.event,
            input.eventId ?? null,
            input.payload ?? '{}',
            input.nextRetryAt,
            input.now,
            input.now,
          )
          .run(),
      'enqueue webhook delivery',
    );
  }

  public async getById(id: string): Promise<WebhookDeliveryRow | null> {
    return this.findRowById<WebhookDeliveryRow>('webhook_deliveries', 'id', id);
  }

  public async listDue(now: number, limit: number): Promise<WebhookDeliveryRow[]> {
    const result = await this.database
      .prepare(
        "SELECT * FROM webhook_deliveries WHERE status = 'pending' AND next_retry_at <= ? ORDER BY next_retry_at ASC, id ASC LIMIT ?",
      )
      .bind(now, limit)
      .all<WebhookDeliveryRow>();
    return result.results ?? [];
  }

  /**
   * Optimistic claim for concurrent flushers (request-triggered `waitUntil`
   * flushes + the cron sweeper): only the worker whose UPDATE flips the row
   * from `pending` proceeds to POST. Returns true when this caller won.
   */
  public async claim(id: string, now: number): Promise<boolean> {
    const result = await this.withRetry(
      () =>
        this.database
          .prepare("UPDATE webhook_deliveries SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'")
          .bind(now, id)
          .run(),
      'claim webhook delivery',
    );
    return ((result.meta as { changes?: number })?.changes ?? 0) > 0;
  }

  public async markSettled(
    id: string,
    input: { status: 'pending' | 'success' | 'failed'; nextRetryAt: number; httpStatus: number | null; error: string | null; now: number },
  ): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'UPDATE webhook_deliveries SET status = ?, next_retry_at = ?, last_http_status = ?, last_error = ?, updated_at = ? WHERE id = ?',
          )
          .bind(input.status, input.nextRetryAt, input.httpStatus, input.error, input.now, id)
          .run(),
      'settle webhook delivery',
    );
  }

  public async resetForRedelivery(id: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            "UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_retry_at = ?, last_http_status = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
          )
          .bind(now, now, id)
          .run(),
      'reset webhook delivery',
    );
  }

  public async listByHook(
    hookId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ deliveries: WebhookDeliveryRow[]; nextCursor: string | null }> {
    const decoded = this.decodeCursorOrThrow<{ created_at: number; id: string }>(cursor);
    const pageSize = limit + 1;
    const result =
      decoded === undefined
        ? await this.database
            .prepare('SELECT * FROM webhook_deliveries WHERE hook_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
            .bind(hookId, pageSize)
            .all<WebhookDeliveryRow>()
        : await this.database
            .prepare(
              'SELECT * FROM webhook_deliveries WHERE hook_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?',
            )
            .bind(hookId, decoded.created_at, decoded.created_at, decoded.id, pageSize)
            .all<WebhookDeliveryRow>();
    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return { deliveries: page, nextCursor: hasMore && last ? this.encodeCursor({ created_at: last.created_at, id: last.id }) : null };
  }

  public async countByHook(hookId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS n FROM webhook_deliveries WHERE hook_id = ?')
      .bind(hookId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM webhook_deliveries WHERE repository_id = ?').bind(repositoryId).run(),
      'delete webhook deliveries by repo',
    );
  }

  public async pruneOlderThan(cutoff: number, limit: number): Promise<number> {
    return this.deleteRowsOlderThan('webhook_deliveries', 'created_at', cutoff, limit, 'id');
  }
}

export { WebhookDeliveryDAO };
export type { WebhookDeliveryRow };
