import { describe, expect, it } from 'vitest';
import { branchNameSchema, assetNameSchema, usernameSchema, teamSlugSchema, repoNameSchema } from '@duradav/shared/validation';

describe('branch name schema hardening', () => {
  it('accepts normal branches incl. slashes', () => {
    for (const ok of ['main', 'feature/login', 'release-1.2', 'a/b/c', 'UPPER_case-1.x']) {
      expect(branchNameSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it('rejects git-check-ref-format violations (ReceiveParser parity)', () => {
    for (const bad of [
      'a..b',
      'a//b',
      'trailing.',
      'trailing/',
      'name.lock',
      'has space',
      'a~b',
      'a^b',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a@',
      '@',
      '.',
      '../escape',
      'a\0b',
      'a\nb',
    ]) {
      expect(branchNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('rejects empty/overlong', () => {
    expect(branchNameSchema.safeParse('').success).toBe(false);
    expect(branchNameSchema.safeParse('   ').success).toBe(false);
    expect(branchNameSchema.safeParse('a'.repeat(256)).success).toBe(false);
  });
});

describe('asset name schema hardening', () => {
  it('accepts normal asset names', () => {
    for (const ok of ['app.tar.gz', 'binary-linux-amd64', 'release notes.zip', 'v1.2.3-checksums.txt']) {
      expect(assetNameSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it('rejects traversal and separators', () => {
    for (const bad of ['../escape', '..', 'a/b', 'a\\b', '.git', 'a\0b', '']) {
      expect(assetNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('identity schemas', () => {
  it('accepts valid usernames/teams/repos', () => {
    expect(usernameSchema.safeParse('alice').success).toBe(true);
    expect(teamSlugSchema.safeParse('org-team1').success).toBe(true);
    expect(repoNameSchema.safeParse('my.repo-1_x').success).toBe(true);
  });

  it('rejects empty/overlong/blank', () => {
    expect(usernameSchema.safeParse('').success).toBe(false);
    expect(usernameSchema.safeParse('a'.repeat(40)).success).toBe(false);
    expect(repoNameSchema.safeParse('').success).toBe(false);
  });
});
