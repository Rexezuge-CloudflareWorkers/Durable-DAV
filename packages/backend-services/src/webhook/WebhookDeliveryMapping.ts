import type { WebhookDeliveryRow } from '@duradav/backend-data/dao';
import type { WebhookDeliveryMetadata } from '@duradav/shared';

/**
 * Pure delivery mapping policy for webhooks (Layer 3).
 *
 * Extracted from `WebhookDeliveryService` so row mapping stays unit-testable
 * without D1. The service remains the orchestration facade
 * (enqueue/claim/settle); subscription matching reads the `webhook_events`
 * junction via the DAO, mirroring the `WebhookRetryPolicy` split.
 */

function toPublicDelivery(row: WebhookDeliveryRow): WebhookDeliveryMetadata {
  return {
    id: row.id,
    hookId: row.hook_id,
    repositoryId: row.repository_id,
    event: row.event,
    eventId: row.event_id,
    status: row.status === 'success' ? 'success' : row.status === 'failed' ? 'failed' : 'pending',
    attempts: row.attempts,
    nextRetryAt: row.next_retry_at,
    lastHttpStatus: row.last_http_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveSenderUsername(actorUsername?: string): string {
  return actorUsername ?? 'ghost';
}

export { resolveSenderUsername, toPublicDelivery };
