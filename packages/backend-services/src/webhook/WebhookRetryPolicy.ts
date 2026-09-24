/**
 * Pure webhook retry policy (Otter pure-helper pattern).
 *
 * Extracted from `WebhookDeliveryService` so backoff/terminal rules are
 * unit testable without D1 or fetch.
 */
const WEBHOOK_BACKOFF_SCHEDULE_SECONDS = [60, 600, 3600, 21_600, 86_400] as const;

// Retry on 429/5xx + network/timeout failures. Other 4xx are terminal
// (the receiver rejected the payload — retrying never helps).
function isRetryableHttpStatus(status: number | null): boolean {
  if (status === null) return true;
  return status === 429 || (status >= 500 && status <= 599);
}

// Linear-ish backoff in seconds by 1-based attempt: 1m, 10m, 1h, 6h, 24h.
function backoffSecondsForAttempt(attempt: number): number {
  const schedule = WEBHOOK_BACKOFF_SCHEDULE_SECONDS;
  return schedule[Math.min(Math.max(attempt, 1), schedule.length) - 1];
}

export { WEBHOOK_BACKOFF_SCHEDULE_SECONDS, backoffSecondsForAttempt, isRetryableHttpStatus };
