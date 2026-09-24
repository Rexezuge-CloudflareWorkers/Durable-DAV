import { describe, expect, it } from 'vitest';
import { usernameSchema, teamSlugSchema, repoNameSchema, branchNameSchema, assetNameSchema } from '@duradav/shared/validation/schemas';
import { TimestampUtil } from '@duradav/shared/utils/TimestampUtil';
import { canonicalizeLanguageTag } from '@duradav/shared/utils/LanguageTag';
import { mapServiceError, toServiceStatus, hideExistence } from '@duradav/backend-services/errors/ErrorMapper';
import { AuthorizationGuard } from '@duradav/backend-services/permission/AuthorizationGuardService';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';

describe('shared validation schemas', () => {
  it('accepts valid names and rejects bad input', () => {
    expect(usernameSchema.safeParse('alice').success).toBe(true);
    expect(usernameSchema.safeParse('').success).toBe(false);
    expect(usernameSchema.safeParse('x'.repeat(40)).success).toBe(false);
    expect(teamSlugSchema.safeParse('dev-team').success).toBe(true);
    expect(teamSlugSchema.safeParse('bad slug!').success).toBe(false);
    expect(repoNameSchema.safeParse('my-repo.js').success).toBe(true);
    expect(repoNameSchema.safeParse('').success).toBe(false);
    expect(branchNameSchema.safeParse('feature/x').success).toBe(true);
    expect(branchNameSchema.safeParse('a..b').success).toBe(false);
    expect(branchNameSchema.safeParse('a\0b').success).toBe(false);
    expect(assetNameSchema.safeParse('a'.repeat(256)).success).toBe(false);
    expect(assetNameSchema.safeParse('bundle.zip').success).toBe(true);
  });
});

describe('timestamp and language utils', () => {
  it('covers all arithmetic helpers', () => {
    expect(TimestampUtil.addMinutes(1000, 1)).toBe(1060);
    expect(TimestampUtil.addHours(0, 1)).toBe(3600);
    expect(TimestampUtil.addDays(0, 1)).toBe(86_400);
    expect(TimestampUtil.subtractMinutes(1000, 1)).toBe(940);
    expect(TimestampUtil.subtractDays(86_400, 1)).toBe(0);
    expect(TimestampUtil.getCurrentUnixTimestampInMilliseconds()).toBeGreaterThan(0);
    expect(TimestampUtil.getCurrentUnixTimestampInSeconds()).toBeGreaterThan(0);
  });

  it('canonicalizes language tags', () => {
    expect(canonicalizeLanguageTag('')).toBe('en');
    expect(canonicalizeLanguageTag('EN_us')).toBe('en-US');
    expect(canonicalizeLanguageTag('zh-cn')).toBe('zh-CN');
    expect(canonicalizeLanguageTag('pt-br-x')).toBe('pt-BR-x');
    expect(canonicalizeLanguageTag('fr')).toBe('fr');
  });
});

describe('error mapper and guard', () => {
  it('maps service errors and masks unknown', () => {
    const bad = new BadRequestError('nope');
    expect(mapServiceError(bad).status).toBe(400);
    expect(toServiceStatus(bad)).toBe(400);
    expect(toServiceStatus(new NotFoundError('missing'))).toBe(404);
    expect(toServiceStatus(new Error('boom'))).toBe(500);
    expect(mapServiceError(new Error('boom'), 'zh-CN').status).toBe(500);
  });

  it('hideExistence maps throws to null', async () => {
    await expect(hideExistence(async () => 'v')).resolves.toBe('v');
    await expect(
      hideExistence(async () => {
        throw new Error('gone');
      }),
    ).resolves.toBeNull();
  });

  it('AuthorizationGuard hides private repos and enforces rank', async () => {
    const repo = { id: 'r1' } as never;
    const admin = new AuthorizationGuard({ getRole: async () => 'admin' } as never);
    await expect(admin.requireVisible('a@x.com', null)).resolves.toBeNull();
    await expect(admin.requireVisible('a@x.com', repo)).resolves.toBe(repo);
    await expect(admin.requireRole('a@x.com', repo, 'write')).resolves.toMatchObject({ role: 'admin' });
    const none = new AuthorizationGuard({ getRole: async () => null } as never);
    await expect(none.requireVisible('a@x.com', repo)).resolves.toBeNull();
    await expect(none.requireRole('a@x.com', repo, 'read')).resolves.toBeNull();
    const reader = new AuthorizationGuard({ getRole: async () => 'read' } as never);
    await expect(reader.requireRole('a@x.com', repo, 'write')).resolves.toBeNull();
    const flaky = new AuthorizationGuard({
      getRole: async () => {
        throw new Error('d1 down');
      },
    } as never);
    await expect(flaky.requireVisible('a@x.com', repo)).resolves.toBeNull();
  });
});
