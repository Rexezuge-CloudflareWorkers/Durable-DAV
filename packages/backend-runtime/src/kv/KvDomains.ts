// Single-KV keyspace: one `CACHE` binding, domains separated by key prefix.
//
// Rationale: D1 stays the source of truth (joins, transactions, FTS). KV is a
// loss-tolerant, read-heavy cache only — a miss or eviction must always be
// recoverable by recompute. Call sites never touch `env.CACHE` directly;
// they go through `KvCache` with a closed `KvDomainName` registry so prefixes
// cannot collide and TTL/size policy lives in one table.

const KV_KEY_VERSION = 'v1';
const KV_MAX_KEY_LENGTH = 512;
const KV_MIN_TTL_SECONDS = 60;
const KV_PLATFORM_MAX_VALUE_BYTES = 26_214_400;

type KvDomainName = 'jwks' | 'oauth2' | 'code' | 'searchCursor' | 'refs' | 'readmodel' | 'ratelimit';

interface KvDomainDef {
  ttlSeconds?: number;
  maxValueBytes: number;
  description: string;
}

const KV_DOMAINS: Record<KvDomainName, KvDomainDef> = {
  jwks: {
    ttlSeconds: 600,
    maxValueBytes: 65_536,
    description: 'Cloudflare Access JWKS cert documents per team domain.',
  },
  oauth2: {
    ttlSeconds: 3600,
    maxValueBytes: 16_384,
    description: 'OAuth token artefacts; per-entry TTL should track expiry.',
  },
  code: {
    maxValueBytes: 1_048_576,
    description: 'Indexed file bodies (D1 code_index keeps metadata only). Persistent until invalidated on push.',
  },
  searchCursor: {
    ttlSeconds: 604_800,
    maxValueBytes: 4096,
    description: 'Search backfill cron progress markers per repo.',
  },
  refs: {
    ttlSeconds: 86_400,
    maxValueBytes: 1_048_576,
    description: 'Advertised ref snapshots per repo; invalidated on receive-pack. Long-lived (24h) to keep DO rows_read low.',
  },
  readmodel: {
    ttlSeconds: 86_400,
    maxValueBytes: 1_048_576,
    description: 'Repo read-model snapshots (overview/branches/tags/tree/commits/blob) keyed by head oid; invalidated on push. Long-lived (24h) to keep DO rows_read low.',
  },
  ratelimit: {
    ttlSeconds: 60,
    maxValueBytes: 1024,
    description: 'Rate-limit / idempotency windows. Short-lived by design.',
  },
};

function fnv1aHex(input: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) throw new Error('KV key segment must not be empty.');
  return encodeURIComponent(trimmed);
}

function buildKvKey(domain: KvDomainName, parts: readonly string[]): string {
  const def = KV_DOMAINS[domain];
  if (!def) throw new Error(`Unknown KV domain: ${domain}.`);
  if (parts.length === 0) throw new Error(`KV domain ${domain} requires at least one key part.`);
  const prefix = `${domain}:${KV_KEY_VERSION}:`;
  const joined = parts.map((part) => sanitizeSegment(part)).join(':');
  const full = prefix + joined;
  if (full.length <= KV_MAX_KEY_LENGTH) return full;
  // Deterministic fallback: a miss just recomputes, so a 32-bit digest is fine.
  return `${prefix}h:${fnv1aHex(joined)}`;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function clampTtl(ttlSeconds: number | undefined, domain: KvDomainName): number | undefined {
  const effective = ttlSeconds ?? KV_DOMAINS[domain].ttlSeconds;
  if (effective === undefined) return undefined;
  if (!Number.isFinite(effective)) return undefined;
  return Math.max(KV_MIN_TTL_SECONDS, Math.floor(effective));
}

export { KV_DOMAINS, KV_KEY_VERSION, KV_MAX_KEY_LENGTH, KV_MIN_TTL_SECONDS, KV_PLATFORM_MAX_VALUE_BYTES };
export { buildKvKey, clampTtl, fnv1aHex, utf8ByteLength };
export type { KvDomainDef, KvDomainName };
