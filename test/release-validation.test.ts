import { describe, expect, it } from 'vitest';
import { BadRequestError } from '@duradav/backend-errors';
import {
  isValidTagName,
  normalizeAssetName,
  normalizeAssetSha256,
  normalizeContentType,
  normalizeReleaseBody,
  normalizeReleaseName,
  normalizeTagName,
} from '../packages/backend-services/src/release/ReleaseValidation';
import { ReleaseService } from '../packages/backend-services/src/release/ReleaseService';

describe('harden: ReleaseValidation policy (extracted from ReleaseService)', () => {
  it('normalizes tags and strips .git suffix', () => {
    expect(normalizeTagName('v1.0.0')).toBe('v1.0.0');
    expect(normalizeTagName('v1.git')).toBe('v1');
    expect(() => normalizeTagName('')).toThrow(BadRequestError);
    expect(() => normalizeTagName('a..b')).toThrow(BadRequestError);
    expect(() => normalizeTagName('/lead')).toThrow(BadRequestError);
    expect(() => normalizeTagName('has space')).toThrow(BadRequestError);
    expect(isValidTagName('v2')).toBe(true);
    expect(isValidTagName('')).toBe(false);
  });

  it('keeps the service facade in sync with the policy module', () => {
    expect(ReleaseService.isValidTagName('v1')).toBe(true);
    expect(ReleaseService.isValidTagName('..')).toBe(false);
  });

  it('truncates names/bodies and defaults content types', () => {
    expect(normalizeReleaseName('  hi  ')).toBe('hi');
    expect(normalizeReleaseName(null)).toBe('');
    expect(normalizeReleaseBody('x'.repeat(20_000))).toHaveLength(10_000);
    expect(normalizeContentType(undefined)).toBe('application/octet-stream');
    expect(normalizeContentType('Text/Plain ')).toBe('text/plain');
    expect(() => normalizeContentType('not-a-mime')).toThrow(BadRequestError);
  });

  it('rejects unsafe asset names and normalizes sha256', () => {
    expect(normalizeAssetName('app.zip')).toBe('app.zip');
    expect(() => normalizeAssetName('../evil')).toThrow(BadRequestError);
    expect(() => normalizeAssetName('a/b')).toThrow(BadRequestError);
    expect(normalizeAssetSha256('A'.repeat(64))).toBe('a'.repeat(64));
    expect(() => normalizeAssetSha256('short')).toThrow(BadRequestError);
  });
});
