import { WebhookDeliveryDAO } from '@duradav/backend-data/dao';
import type { RepoWebhookRow, WebhookDAO, WebhookDeliveryRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { NotFoundError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { WebhookDeliveryMetadata, WebhookEventName } from '@duradav/shared';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { buildWebhookPayload, normalizeEvents, signDelivery, validateWebhookUrl } from './WebhookEvents';
import { backoffSecondsForAttempt, isRetryableHttpStatus } from './WebhookRetryPolicy';
import { resolveSenderUsername, toPublicDelivery } from './WebhookDeliveryMapping';
import { defaultPostJson, STORED_ERROR_CHAR_LIMIT } from './WebhookHttpClient';
import type { WebhookPostJson } from './WebhookHttpClient';

interface WebhookDeliveryServiceEnv {
  DB: D1Queryable;
  WEBHOOK_MAX_ATTEMPTS?: string;
  WEBHOOK_TIMEOUT_MS?: string;
  WEBHOOK_MAX_CONSECUTIVE_FAILURES?: string;
  WEBHOOK_MAX_PAYLOAD_BYTES?: string;
}

interface WebhookDeliveryServiceDeps {
  webhookDAO?: () => Promise<WebhookDAO>;
  deliveryDAO?: () => Promise<WebhookDeliveryDAO>;
  postJson?: WebhookPostJson;
}

interface EnqueueEventInput {
  repositoryId: string;
  fullName: string;
  event: WebhookEventName;
  actorUsername?: string;
  eventId?: string | null;
  subjectType?: string | null;
  subjectNumber?: number | null;
  subjectOid?: string | null;
  title?: string | null;
  action?: string | null;
  extra?: Record<string, unknown>;
}

// Retry policy lives in `./WebhookRetryPolicy.ts` (pure, unit testable).
// Transport lives in `./WebhookHttpClient.ts` (Adapter): `defaultPostJson`
// re-validates the stored URL (DNS-rebind guard) and truncates stored errors
// to `STORED_ERROR_CHAR_LIMIT` so D1 rows stay small.

class WebhookDeliveryService {
  private readonly deps: Required<WebhookDeliveryServiceDeps>;

  constructor(
    private readonly env: WebhookDeliveryServiceEnv,
    deps: WebhookDeliveryServiceDeps = {},
  ) {
    this.deps = {
      // Encrypted DAOs require a key: outside the request scope (which wires
      // per-feature keys via daoBindings) callers must inject the DAO.
      webhookDAO: () =>
        Promise.reject<WebhookDAO>(new Error('WebhookDeliveryService requires an injected webhookDAO outside request scope.')),
      deliveryDAO: () => Promise.resolve(new WebhookDeliveryDAO(env.DB)),
      postJson: defaultPostJson,
      ...deps,
    };
  }

  /**
   * Back-compat proxies: prefer importing `backoffSecondsForAttempt` /
   * `isRetryableHttpStatus` from `./WebhookRetryPolicy` directly. Kept so
   * existing route/test imports keep working; will be removed next major.
   * @deprecated Use `WebhookRetryPolicy` directly.
   */
  public static backoffSecondsForAttempt(attempt: number): number {
    return backoffSecondsForAttempt(attempt);
  }

  /**
   * @deprecated Use `isRetryableHttpStatus` from `./WebhookRetryPolicy` directly.
   */
  public static isRetryableHttpStatus(status: number | null): boolean {
    return isRetryableHttpStatus(status);
  }

  // Best-effort fan-out: enqueue one pending delivery per active hook
  // subscribed to the event. Never throws — delivery must not fail the
  // user-visible mutation (mirrors SocialEmit's recordAndNotify contract).
  // DAO outages degrade to `{enqueued: 0}` but are logged so zero-fan-out
  // from an outage is distinguishable from zero-subscriber quiet.
  public async enqueueForEvent(input: EnqueueEventInput): Promise<{ enqueued: number }> {
    try {
      const webhookDAO = await this.deps.webhookDAO();
      const hooks = await webhookDAO.listByRepo(input.repositoryId).catch((error: unknown) => {
        console.warn(`[WARN] [WebhookDeliveryService] listByRepo failed: ${String(error)}`);
        return [] as RepoWebhookRow[];
      });
      const matching: RepoWebhookRow[] = [];
      for (const hook of hooks) {
        if (hook.is_active !== 1) continue;
        // Events live only in the junction table. Minimal test fakes
        // without `listEvents` match nothing (fail closed, never throws).
        let subscribed: WebhookEventName[] = [];
        try {
          if (typeof webhookDAO.listEvents === 'function') {
            subscribed = normalizeEvents(await webhookDAO.listEvents(hook.id));
          }
        } catch {
          subscribed = [];
        }
        if (subscribed.includes(input.event)) matching.push(hook);
      }
      if (matching.length === 0) return { enqueued: 0 };
      const maxBytes = ConfigurationManager.webhooks.getMaxPayloadBytes(this.env);
      const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
      const senderUsername = resolveSenderUsername(input.actorUsername);
      const payload = JSON.stringify(
        buildWebhookPayload({
          event: input.event,
          fullName: input.fullName,
          actorUsername: senderUsername,
          eventId: input.eventId,
          subjectType: input.subjectType,
          subjectNumber: input.subjectNumber,
          subjectOid: input.subjectOid,
          title: input.title,
          action: input.action,
          extra: input.extra,
          processedAt: now,
        }),
      ).slice(0, maxBytes);
      const deliveryDAO = await this.deps.deliveryDAO();
      let enqueued = 0;
      for (const hook of matching) {
        try {
          await deliveryDAO.enqueue({
            id: UUIDUtil.getRandomUUID(),
            hookId: hook.id,
            repositoryId: input.repositoryId,
            event: input.event,
            eventId: input.eventId,
            payload,
            nextRetryAt: now,
            now,
          });
          enqueued += 1;
        } catch (error) {
          // Per-hook best-effort; one bad row must not block the rest.
          console.warn(`[WARN] [WebhookDeliveryService] enqueue failed for hook ${hook.id}: ${String(error)}`);
        }
      }
      return { enqueued };
    } catch (error) {
      console.warn(`[WARN] [WebhookDeliveryService] enqueueForEvent failed: ${String(error)}`);
      return { enqueued: 0 };
    }
  }

  public async listDeliveries(
    hookId: string,
    repositoryId: string,
    limit = 20,
    cursor?: string,
  ): Promise<{ deliveries: WebhookDeliveryMetadata[]; nextCursor: string | null }> {
    const webhookDAO = await this.deps.webhookDAO();
    const hook = await webhookDAO.getByIdAndRepo(hookId, repositoryId).catch(() => null);
    if (!hook) throw new NotFoundError('Webhook not found.');
    const deliveryDAO = await this.deps.deliveryDAO();
    const { deliveries, nextCursor } = await deliveryDAO.listByHook(hookId, Math.min(Math.max(limit, 1), 50), cursor);
    return { deliveries: deliveries.map(toPublicDelivery), nextCursor };
  }

  public async redeliver(deliveryId: string, repositoryId: string): Promise<WebhookDeliveryMetadata> {
    const deliveryDAO = await this.deps.deliveryDAO();
    const row = await deliveryDAO.getById(deliveryId).catch(() => null);
    if (!row || row.repository_id !== repositoryId) throw new NotFoundError('Delivery not found.');
    const webhookDAO = await this.deps.webhookDAO();
    const hook = await webhookDAO.getByIdAndRepo(row.hook_id, repositoryId).catch(() => null);
    if (!hook) throw new NotFoundError('Webhook not found.');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await deliveryDAO.resetForRedelivery(deliveryId, now);
    const updated = await deliveryDAO.getById(deliveryId);
    if (!updated) throw new NotFoundError('Delivery not found.');
    return toPublicDelivery(updated);
  }

  // Attempt one delivery end-to-end (used by the /test route for inline
  // feedback). Creates a ping delivery row, POSTs once, settles the row.
  public async sendTestPing(
    hookId: string,
    repositoryId: string,
    fullName: string,
    actorUsername: string,
  ): Promise<WebhookDeliveryMetadata> {
    const webhookDAO = await this.deps.webhookDAO();
    const hook = await webhookDAO.getByIdAndRepo(hookId, repositoryId).catch(() => null);
    if (!hook) throw new NotFoundError('Webhook not found.');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const maxBytes = ConfigurationManager.webhooks.getMaxPayloadBytes(this.env);
    const payload = JSON.stringify(buildWebhookPayload({ event: 'ping', fullName, actorUsername, action: 'test', processedAt: now })).slice(
      0,
      maxBytes,
    );
    const deliveryDAO = await this.deps.deliveryDAO();
    const id = UUIDUtil.getRandomUUID();
    await deliveryDAO.enqueue({ id, hookId, repositoryId, event: 'ping', payload, nextRetryAt: now, now });
    await this.attemptRow(id, now);
    const settled = await deliveryDAO.getById(id);
    if (!settled) throw new NotFoundError('Delivery not found.');
    return toPublicDelivery(settled);
  }

  // Cron sweeper entry: claim due rows (optimistic per-row claim so overlapping
  // request-triggered flushes never double-POST) and settle each.
  public async processDue(input?: { now?: number; limit?: number }): Promise<{ processed: number; succeeded: number; failed: number }> {
    const now = input?.now ?? TimestampUtil.getCurrentUnixTimestampInSeconds();
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
    const deliveryDAO = await this.deps.deliveryDAO();
    const due = await deliveryDAO.listDue(now, limit).catch((error: unknown) => {
      console.warn(`[WARN] [WebhookDeliveryService] listDue failed: ${String(error)}`);
      return [] as WebhookDeliveryRow[];
    });
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    for (const row of due) {
      const claimed = await deliveryDAO.claim(row.id, now).catch((error: unknown) => {
        console.warn(`[WARN] [WebhookDeliveryService] claim failed for ${row.id}: ${String(error)}`);
        return false;
      });
      if (!claimed) continue;
      processed += 1;
      const ok = await this.attemptRow(row.id, now).catch((error: unknown) => {
        console.warn(`[WARN] [WebhookDeliveryService] attemptRow failed for ${row.id}: ${String(error)}`);
        return false;
      });
      if (ok) succeeded += 1;
      else failed += 1;
    }
    return { processed, succeeded, failed };
  }

  public async pruneOlderThan(cutoff: number, limit: number): Promise<number> {
    const deliveryDAO = await this.deps.deliveryDAO();
    return deliveryDAO.pruneOlderThan(cutoff, limit);
  }

  // POST one claimed row and settle it (success / retry / terminal failure +
  // hook consecutive-failure accounting with auto-disable). Returns true on
  // HTTP success. Why truncate: stored `last_error` is read on every list;
  // the signature covers the stored (possibly truncated-at-enqueue) payload
  // bytes, never the pre-truncation body — truncation happens once at
  // `enqueueForEvent` under the DO size guard, not here.
  private async attemptRow(deliveryId: string, now: number): Promise<boolean> {
    const deliveryDAO = await this.deps.deliveryDAO();
    const webhookDAO = await this.deps.webhookDAO();
    const maxAttempts = ConfigurationManager.webhooks.getMaxAttempts(this.env);
    const timeoutMs = ConfigurationManager.webhooks.getTimeoutMs(this.env);
    const disableAfter = ConfigurationManager.webhooks.getMaxConsecutiveFailures(this.env);
    const row = await deliveryDAO.getById(deliveryId).catch(() => null);
    if (!row) return false;
    const hook = await webhookDAO.getById(row.hook_id).catch(() => null);
    if (!hook || hook.is_active !== 1) {
      await deliveryDAO
        .markSettled(deliveryId, { status: 'failed', nextRetryAt: now, httpStatus: null, error: 'Webhook is missing or disabled.', now })
        .catch(() => undefined);
      return false;
    }
    try {
      validateWebhookUrl(hook.url);
    } catch {
      await deliveryDAO
        .markSettled(deliveryId, { status: 'failed', nextRetryAt: now, httpStatus: null, error: 'Webhook URL is blocked.', now })
        .catch(() => undefined);
      return false;
    }
    const issuedAt = String(now);
    const signature = await signDelivery(hook.secret, row.payload);
    const outcome = await this.deps
      .postJson(hook.url, {
        headers: {
          'X-DuraDav-Event': row.event,
          'X-DuraDav-Delivery': row.id,
          'X-DuraDav-Timestamp': issuedAt,
          'X-DuraDav-Signature-256': signature,
        },
        body: row.payload,
        timeoutMs,
      })
      .catch(() => ({ httpStatus: null as number | null, error: 'Delivery failed.' }));
    const attempts = row.attempts + 1;
    const terminal = !isRetryableHttpStatus(outcome.httpStatus) || attempts >= maxAttempts;
    if (outcome.error === null) {
      await deliveryDAO
        .markSettled(deliveryId, { status: 'success', nextRetryAt: now, httpStatus: outcome.httpStatus, error: null, now })
        .catch(() => undefined);
      await webhookDAO.recordDeliveryOutcome(hook.id, true, now, disableAfter).catch(() => undefined);
      return true;
    }
    await deliveryDAO
      .markSettled(deliveryId, {
        status: terminal ? 'failed' : 'pending',
        nextRetryAt: terminal ? now : now + backoffSecondsForAttempt(attempts),
        httpStatus: outcome.httpStatus,
        error: outcome.error?.slice(0, STORED_ERROR_CHAR_LIMIT) ?? null,
        now,
      })
      .catch(() => undefined);
    if (terminal) {
      await webhookDAO.recordDeliveryOutcome(hook.id, false, now, disableAfter).catch(() => undefined);
    }
    return false;
  }
}

export { WebhookDeliveryService };
export type { WebhookDeliveryServiceDeps, WebhookDeliveryServiceEnv, EnqueueEventInput };
