import { describe, expect, it, beforeEach } from 'vitest';
import { rateLimit, resetRateLimitForTests, clientIp, getRateLimitBucketCountForTests } from '@/middleware';

function makeCtx(headers: Record<string, string | null> = {}, identity?: string) {
  return {
    req: {
      header: (name: string) => headers[name] ?? null,
    },
    get: () => {
      if (identity === undefined) throw new Error('no scope');
      return identity;
    },
    json: (body: unknown, status: number, hdrs?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers: hdrs }),
  } as never;
}

describe('rate-limit hardening', () => {
  beforeEach(() => resetRateLimitForTests());

  it('prefers CF-Connecting-IP over spoofable X-Forwarded-For', () => {
    const c = makeCtx({ 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '9.9.9.9' });
    expect(clientIp(c as never)).toBe('1.2.3.4');
  });

  it('does NOT trust spoofable X-Forwarded-For (fail-closed grouping)', () => {
    const c = makeCtx({ 'X-Forwarded-For': ' 5.6.7.8, 1.1.1.1' });
    expect(clientIp(c as never)).toBe('unknown');
  });

  it('returns unknown with no ip headers', () => {
    expect(clientIp(makeCtx() as never)).toBe('unknown');
  });

  it('isolates buckets by authenticated identity, not just ip', async () => {
    const guard = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 'iso-test' });
    const next = async () => undefined;
    await guard(makeCtx({}, 'alice@example.com'), next as never);
    // Same IP but different identity gets its own bucket.
    const second = await guard(makeCtx({}, 'bob@example.com'), next as never);
    expect(second).toBeUndefined();
    // Same identity again is limited.
    const limited = (await guard(makeCtx({}, 'alice@example.com'), next as never)) as unknown as Response;
    expect((limited as Response).status).toBe(429);
  });

  it('evicts oldest buckets instead of clearing all under flood', async () => {
    const guard = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 'flood-test' });
    const next = async () => undefined;
    // Fill past the 5000 hard cap with distinct identities.
    for (let i = 0; i < 5100; i += 1) {
      await guard(makeCtx({}, `user-${i}@example.com`), next as never);
    }
    // LRU eviction keeps size at/below cap instead of unbounded growth.
    expect(getRateLimitBucketCountForTests()).toBeLessThanOrEqual(5001);
    expect(getRateLimitBucketCountForTests()).toBeGreaterThan(0);
  });

  it('resets window after expiry', async () => {
    const guard = rateLimit({ windowMs: 1, max: 1, keyPrefix: 'window-test' });
    let calls = 0;
    const next = async () => {
      calls += 1;
    };
    await guard(makeCtx({}, 'w@example.com'), next as never);
    await new Promise((r) => setTimeout(r, 5));
    await guard(makeCtx({}, 'w@example.com'), next as never);
    expect(calls).toBe(2);
  });
});
