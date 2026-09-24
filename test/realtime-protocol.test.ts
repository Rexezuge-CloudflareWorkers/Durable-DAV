import { describe, expect, it } from 'vitest';
import {
  INBOX_SHARD,
  MAX_CHANNELS_PER_SOCKET,
  buildEnvelope,
  inboxTagForHash,
  isChannel,
  isEnvelope,
  isInboxHash,
  isRepoShard,
  isShard,
  normalizeChannels,
  parseClientFrame,
  repoShardFor,
} from '@duradav/shared/realtime';

describe('realtime shards and channels', () => {
  it('builds lowercase repo shards and validates the shard set', () => {
    expect(repoShardFor('Alice/Demo')).toBe('repo:alice/demo');
    expect(isRepoShard('repo:alice/demo')).toBe(true);
    expect(isRepoShard(INBOX_SHARD)).toBe(false);
    expect(isShard(INBOX_SHARD)).toBe(true);
    expect(isShard('repo:alice/demo')).toBe(true);
    expect(isShard('repo:alice')).toBe(false);
    expect(isShard('inbox:other')).toBe(false);
    expect(isShard('')).toBe(false);
  });

  it('accepts subject channels and per-user inbox tags only', () => {
    expect(isChannel('activity')).toBe(true);
    expect(isChannel('presence')).toBe(true);
    expect(isChannel('issue:12')).toBe(true);
    expect(isChannel('pr:34')).toBe(true);
    expect(isChannel('checks:abcdef1234567890')).toBe(true);
    expect(isChannel('inbox:0123456789abcdef')).toBe(true);
    expect(isChannel('inbox')).toBe(false);
    expect(isChannel('issue:abc')).toBe(false);
    expect(isChannel('checks:XYZ')).toBe(false);
    expect(isChannel('repo:alice/demo')).toBe(false);
    expect(isChannel('')).toBe(false);
  });

  it('normalizes channel lists with dedupe and caps', () => {
    expect(normalizeChannels(['issue:1', 'issue:1', 'bogus', 'pr:2'])).toEqual(['issue:1', 'pr:2']);
    expect(normalizeChannels('issue:1')).toEqual([]);
    expect(normalizeChannels(null)).toEqual([]);
    const many = Array.from({ length: MAX_CHANNELS_PER_SOCKET + 5 }, (_, i) => `issue:${i + 1}`);
    expect(normalizeChannels(many)).toHaveLength(MAX_CHANNELS_PER_SOCKET);
  });

  it('validates inbox hashes and builds tags', () => {
    expect(isInboxHash('0123456789abcdef')).toBe(true);
    expect(isInboxHash('short')).toBe(false);
    expect(isInboxHash('NOTHEXNOTHEXNOTH')).toBe(false);
    expect(inboxTagForHash('0123456789abcdef')).toBe('inbox:0123456789abcdef');
    expect(isChannel(inboxTagForHash('0123456789abcdef'))).toBe(true);
  });
});

describe('realtime envelopes', () => {
  it('builds and validates envelopes, rejecting bad shapes', () => {
    const envelope = buildEnvelope({
      id: 'evt-1',
      ts: 1_700_000_000,
      channel: 'issue:12',
      type: 'issue_commented',
      actor: 'a@example.com',
      title: 'Commented',
      subjectType: 'issue',
      subjectNumber: 12,
    });
    expect(envelope).not.toBeNull();
    expect(isEnvelope(envelope)).toBe(true);
    expect(buildEnvelope({ id: 'x', ts: 1, channel: 'bogus', type: 'issue_commented', actor: '', title: '' })).toBeNull();
    expect(buildEnvelope({ id: 'x', ts: 1, channel: 'issue:1', type: 'BAD TYPE!', actor: '', title: '' })).toBeNull();
    expect(isEnvelope({ v: 1, id: 'x', ts: 1, channel: 'issue:1', type: 'ok', actor: '', title: 't'.repeat(201) })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });

  it('truncates overlong titles instead of rejecting', () => {
    const envelope = buildEnvelope({ id: 'x', ts: 1, channel: 'activity', type: 'repo.push', actor: '', title: 't'.repeat(500) });
    expect(envelope?.title).toHaveLength(200);
  });
});

describe('realtime client frames', () => {
  it('accepts presence heartbeats and typing indicators on valid channels', () => {
    expect(parseClientFrame(JSON.stringify({ kind: 'presence.heartbeat', channel: 'presence' }))).toMatchObject({
      kind: 'presence.heartbeat',
      channel: 'presence',
    });
    expect(parseClientFrame(JSON.stringify({ kind: 'typing.start', channel: 'issue:3', name: 'Al' }))).toMatchObject({
      kind: 'typing.start',
      channel: 'issue:3',
      name: 'Al',
    });
  });

  it('rejects forged, oversized, and malformed frames', () => {
    expect(parseClientFrame(JSON.stringify({ kind: 'issue_commented', channel: 'issue:3' }))).toBeNull();
    expect(parseClientFrame(JSON.stringify({ kind: 'typing.start', channel: 'bogus' }))).toBeNull();
    expect(parseClientFrame('not json')).toBeNull();
    expect(parseClientFrame('')).toBeNull();
    expect(parseClientFrame('x'.repeat(5000))).toBeNull();
    expect(parseClientFrame(new ArrayBuffer(8) as unknown as string)).toBeNull();
  });
});
