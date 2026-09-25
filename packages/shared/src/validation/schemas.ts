import { z } from 'zod';
import { OWNER_PATTERN } from '../utils/Identity';

const usernameSchema = z.string().trim().min(1).max(39).regex(OWNER_PATTERN, 'Invalid username');

const MAX_RESOURCE_NUMBER = 2_147_483_647;

function parsePositiveInt(raw: string | undefined | null, max: number = MAX_RESOURCE_NUMBER): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return null;
  if (parsed < 1 || parsed > max) return null;
  return parsed;
}

const tokenIdSchema = z.string().trim().uuid('Invalid token id');
const credentialIdSchema = z.string().trim().uuid('Invalid credential id');

export {
  usernameSchema,
  parsePositiveInt,
  tokenIdSchema,
  credentialIdSchema,
  MAX_RESOURCE_NUMBER,
};
