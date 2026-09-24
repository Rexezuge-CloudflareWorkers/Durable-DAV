// Pure release validation policies (Policy pattern).
//
// Extracted from `ReleaseService` so tag/asset rules are unit-testable
// without D1 and reusable from routes. The service keeps orchestration
// (DAO calls, limits, timestamps); this module owns only pure input rules.
import { BadRequestError } from '@duradav/backend-errors';

const TAG_NAME_RE = /^[\w./-]{1,100}$/;
const TAG_FORBIDDEN_RE = /[~^:?*[\]\\@{ \t\n]/;
const ASSET_NAME_RE = /^\w[\w. ()-]{0,254}$/;
const MAX_RELEASE_NAME = 100;
const MAX_RELEASE_BODY = 10_000;
const MAX_CONTENT_TYPE = 127;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

function normalizeTagName(raw: unknown): string {
  if (typeof raw !== 'string') throw new BadRequestError('tagName is required');
  const tag = raw.trim().replace(/\.git$/i, '');
  if (!TAG_NAME_RE.test(tag)) throw new BadRequestError('tagName must be 1-100 chars of letters, digits, `.`, `-`, `_`, `/`');
  if (TAG_FORBIDDEN_RE.test(tag) || tag.includes('..') || tag.includes('//')) {
    throw new BadRequestError('tagName must not contain `..`, `//`, spaces, or `~^:?*[\\@{`');
  }
  if (tag.startsWith('/') || tag.endsWith('/') || tag.endsWith('.'))
    throw new BadRequestError('tagName must not start with `/` or end with `/` or `.`');
  return tag;
}

function isValidTagName(tag: string): boolean {
  try {
    normalizeTagName(tag);
    return true;
  } catch {
    return false;
  }
}

function normalizeReleaseName(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new BadRequestError('name must be a string');
  return raw.trim().slice(0, MAX_RELEASE_NAME);
}

function normalizeReleaseBody(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new BadRequestError('body must be a string');
  return raw.slice(0, MAX_RELEASE_BODY);
}

function normalizeAssetName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new BadRequestError('asset name is required');
  const name = raw.trim();
  if (name.length > 255 || !ASSET_NAME_RE.test(name)) throw new BadRequestError('asset name must be 1-255 safe path chars');
  if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new BadRequestError('asset name must be a plain file name');
  return name;
}

function normalizeContentType(raw: unknown): string {
  if (raw === undefined || raw === null) return 'application/octet-stream';
  if (typeof raw !== 'string' || !raw.trim()) return 'application/octet-stream';
  const value = raw.trim().slice(0, MAX_CONTENT_TYPE).toLowerCase();
  if (!MIME_RE.test(value)) throw new BadRequestError('contentType must be a valid MIME type');
  return value;
}

function normalizeAssetSha256(raw: unknown): string {
  if (typeof raw !== 'string' || !SHA256_RE.test(raw)) throw new BadRequestError('sha256 must be a 64-char hex string');
  return raw.toLowerCase();
}

export {
  TAG_NAME_RE,
  TAG_FORBIDDEN_RE,
  ASSET_NAME_RE,
  MAX_RELEASE_NAME,
  MAX_RELEASE_BODY,
  MAX_CONTENT_TYPE,
  normalizeTagName,
  isValidTagName,
  normalizeReleaseName,
  normalizeReleaseBody,
  normalizeAssetName,
  normalizeContentType,
  normalizeAssetSha256,
};
