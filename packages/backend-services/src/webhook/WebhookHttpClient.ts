import { validateWebhookUrl } from './WebhookEvents';

/**
 * HTTP adapter for webhook deliveries (Adapter + Strategy patterns).
 *
 * Why: `WebhookDeliveryService` mixed fetch wiring, SSRF re-validation,
 * cleartext-http warnings, and retry settlement in one 343-line class.
 * Extracting the transport here leaves the service as a pure orchestration
 * facade (`enqueue/processDue/redeliver`) and makes the HTTP layer
 * injectable/fakeable without D1.
 */

// Stored-error truncation budget (previously `ERROR_PREVIEW_LIMIT`).
// Why 500: delivery rows are read on every list/redeliver; larger previews
// bloat D1 rows_read without helping operators diagnose beyond the first
// line of a fetch/SSRF failure.
const STORED_ERROR_CHAR_LIMIT = 500;
// Back-compat alias: existing imports reference `ERROR_PREVIEW_LIMIT`.
const ERROR_PREVIEW_LIMIT = STORED_ERROR_CHAR_LIMIT;

interface WebhookPostInit {
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

interface WebhookPostOutcome {
  httpStatus: number | null;
  error: string | null;
}

type WebhookPostJson = (url: string, init: WebhookPostInit) => Promise<WebhookPostOutcome>;

async function defaultPostJson(url: string, init: WebhookPostInit): Promise<WebhookPostOutcome> {
  try {
    // Re-validate on delivery: the stored hook URL may have been valid at
    // creation but rebound via DNS since. Literal-IP/private hosts are
    // rejected here; DNS-resolved private IPs remain documented best-effort
    // (no resolver in Workers — use allowlist/egress proxy for strict).
    validateWebhookUrl(url);
  } catch (error) {
    return { httpStatus: null, error: error instanceof Error ? error.message.slice(0, STORED_ERROR_CHAR_LIMIT) : 'Invalid webhook URL.' };
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...init.headers },
      body: init.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeoutMs),
    });
    // Secrets ride in `X-DuraDav-Signature-256`: http: deliveries send the
    // HMAC cleartext. Allowed for local dev, but warn so operators notice.
    try {
      if (new URL(url).protocol === 'http:') console.warn('Webhook delivery over cleartext http — prefer https');
    } catch {
      // URL already validated above; warning must never fail delivery.
    }
    await response.arrayBuffer().catch(() => undefined);
    if (response.ok) return { httpStatus: response.status, error: null };
    return { httpStatus: response.status, error: `Webhook returned HTTP ${response.status}` };
  } catch (error) {
    return { httpStatus: null, error: error instanceof Error ? error.message.slice(0, STORED_ERROR_CHAR_LIMIT) : 'Delivery failed.' };
  }
}

export { defaultPostJson, STORED_ERROR_CHAR_LIMIT, ERROR_PREVIEW_LIMIT };
export type { WebhookPostInit, WebhookPostOutcome, WebhookPostJson };
