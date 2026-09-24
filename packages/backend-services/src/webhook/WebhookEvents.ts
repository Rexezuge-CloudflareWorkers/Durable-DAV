import type { RepoEventType } from '@duradav/backend-data/dao';
import type { WebhookEventName } from '@duradav/shared';
import {
  CryptoUtil,
  MAX_SHARED_URL_LENGTH,
  stripHostTrailingDot,
  isEncodedNumericHost,
  isBlockedIpv6Host,
  isLoopbackHost,
  isLocalhostName,
} from '@duradav/shared/utils';

const WEBHOOK_EVENTS: readonly WebhookEventName[] = [
  'push',
  'repository',
  'issues',
  'issue_comment',
  'pull_request',
  'pull_request_review',
  'fork',
  'star',
  'watch',
  'release',
  'project',
  'discussion',
  'discussion_comment',
  'wiki',
  'snippet',
  'check_run',
  'check_suite',
  'ping',
];

const MAX_URL_LENGTH = MAX_SHARED_URL_LENGTH;
const URL_PREFIX_LENGTH = 30;
const SECRET_SUFFIX_LENGTH = 4;
const IPV4_HOST_PATTERN = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;

function stripTrailingDot(host: string): string {
  return stripHostTrailingDot(host);
}

function isNumericOrEncodedHost(host: string): boolean {
  return isEncodedNumericHost(host);
}

function normalizeEvents(input: unknown): WebhookEventName[] {
  if (!Array.isArray(input)) throw new Error('events must be an array of event names');
  const seen = new Set<WebhookEventName>();
  for (const entry of input) {
    if (typeof entry !== 'string' || !(WEBHOOK_EVENTS as readonly string[]).includes(entry)) {
      throw new Error(`unsupported webhook event: ${typeof entry === 'string' ? entry : '?'}. Supported: ${WEBHOOK_EVENTS.join(', ')}`);
    }
    seen.add(entry as WebhookEventName);
  }
  if (seen.size === 0) throw new Error('events must include at least one event');
  return [...seen];
}

function mapRepoEventToWebhookEvent(type: RepoEventType): WebhookEventName | null {
  switch (type) {
    case 'push': {
      return 'push';
    }
    case 'repo_created': {
      return 'repository';
    }
    case 'issue_opened':
    case 'issue_closed':
    case 'issue_reopened': {
      return 'issues';
    }
    case 'issue_commented': {
      return 'issue_comment';
    }
    case 'pr_opened':
    case 'pr_closed':
    case 'pr_merged': {
      return 'pull_request';
    }
    case 'pr_reviewed':
    case 'pr_commented': {
      return 'pull_request_review';
    }
    case 'fork_created': {
      return 'fork';
    }
    case 'release_created':
    case 'release_published': {
      return 'release';
    }
    case 'project_created':
    case 'project_closed':
    case 'project_reopened': {
      return 'project';
    }
    case 'discussion_opened':
    case 'discussion_answered':
    case 'discussion_locked': {
      return 'discussion';
    }
    case 'discussion_commented': {
      return 'discussion_comment';
    }
    case 'wiki_created':
    case 'wiki_updated': {
      return 'wiki';
    }
    case 'snippet_created': {
      return 'snippet';
    }
    default: {
      return null;
    }
  }
}

function maskUrl(url: string): string {
  return url.length > URL_PREFIX_LENGTH ? `${url.slice(0, URL_PREFIX_LENGTH)}...` : url;
}

function secretSuffix(secret: string): string {
  return secret.slice(-SECRET_SUFFIX_LENGTH);
}

/**
 * Best-effort SSRF guard for outbound hook URLs. Rejects non-http(s)
 * schemes, over-long URLs, and literal loopback/link-local/private/metadata
 * hostnames. DNS-resolved private IPs are NOT covered (no resolver in the
 * request path) — documented on the route.
 */
function validateWebhookUrl(raw: string): void {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw new Error('url is required');
  const url = raw.trim();
  if (url.length > MAX_URL_LENGTH) throw new Error(`url must be at most ${MAX_URL_LENGTH} characters`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('url must be a valid absolute URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('url must use http or https');
  if (parsed.username || parsed.password) throw new Error('url must not embed credentials');
  const rawHost = parsed.hostname.toLowerCase();
  const host = stripTrailingDot(rawHost);
  if (host === '' || host.includes('%') || host.includes('_')) throw new Error('url must target a valid hostname');
  if (isLocalhostName(host)) {
    throw new Error('url must not target localhost');
  }
  if (isBlockedIpv6Host(host)) throw new Error('url must not target a private or reserved address');
  if (isNumericOrEncodedHost(host)) throw new Error('url must not target a private or reserved address');
  if (isLoopbackHost(host)) throw new Error('url must not target a loopback address');
  const ipv4 = IPV4_HOST_PATTERN.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    const loopback = a === 127;
    const rfc1918 = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    const linkLocal = a === 169 && b === 254;
    const carrierGrade = a === 100 && b >= 64 && b <= 127;
    if (loopback || rfc1918 || linkLocal || carrierGrade || a === 0) throw new Error('url must not target a private or reserved address');
  }
}

function generateHookSecret(): string {
  // Unique per hook (32 random bytes, base64url). Never shared across hooks
  // and never derived from a generic platform key.
  return CryptoUtil.randomBase64Url(32);
}

/**
 * Re-validate a webhook redirect target. Callers following redirects
 * manually must pass every hop through `validateWebhookUrl` (same guard as
 * the original URL); DNS-rebind between validation and connect is NOT
 * covered (no resolver in Workers) — documented on the route.
 */
function resolveWebhookRedirect(base: string, location: string): string {
  if (typeof location !== 'string' || location.trim().length === 0) {
    throw new Error('webhook returned an empty redirect');
  }
  let next: string;
  try {
    next = new URL(location, base).href;
  } catch {
    throw new Error('webhook returned an invalid redirect');
  }
  validateWebhookUrl(next);
  return next;
}

async function signDelivery(secret: string, body: string): Promise<string> {
  return `sha256=${await CryptoUtil.hmacSha256Hex(body, secret)}`;
}

async function verifyDeliverySignature(secret: string, body: string, signature: string): Promise<boolean> {
  const expected = await signDelivery(secret, body);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= (expected.codePointAt(i) ?? 0) ^ (signature.codePointAt(i) ?? 0);
  }
  return diff === 0;
}

interface WebhookPayloadInput {
  event: string;
  fullName: string;
  actorUsername?: string;
  eventId?: string | null;
  subjectType?: string | null;
  subjectNumber?: number | null;
  subjectOid?: string | null;
  title?: string | null;
  action?: string | null;
  extra?: Record<string, unknown>;
  processedAt: number;
}

function buildWebhookPayload(input: WebhookPayloadInput): Record<string, unknown> {
  // `extra` is allowlisted: reserved top-level keys can never be clobbered
  // by caller-controlled extra fields.
  const safeExtra: Record<string, unknown> = { ...input.extra };
  delete safeExtra.event;
  delete safeExtra.repository;
  delete safeExtra.sender;
  delete safeExtra.processed_at;
  // Public payloads expose only the username — never the stored email.
  const senderUsername = input.actorUsername ?? 'ghost';
  return {
    event: input.event,
    repository: { full_name: input.fullName },
    sender: { username: senderUsername },
    ...(input.eventId && { delivery_source_id: input.eventId }),
    ...(input.subjectType && { subject_type: input.subjectType }),
    ...(input.subjectNumber !== undefined && input.subjectNumber !== null && { subject_number: input.subjectNumber }),
    ...(input.subjectOid && { subject_oid: input.subjectOid }),
    ...(input.title && { title: input.title.slice(0, 200) }),
    ...(input.action && { action: input.action }),
    ...safeExtra,
    processed_at: input.processedAt,
  };
}

export {
  WEBHOOK_EVENTS,
  MAX_URL_LENGTH,
  URL_PREFIX_LENGTH,
  normalizeEvents,
  mapRepoEventToWebhookEvent,
  maskUrl,
  secretSuffix,
  validateWebhookUrl,
  generateHookSecret,
  resolveWebhookRedirect,
  signDelivery,
  verifyDeliverySignature,
  buildWebhookPayload,
};
export type { WebhookPayloadInput };
