/**
 * Canonical org/team slug validation (Layer 0).
 *
 * Single namespace rule shared by user/org/team names (previously
 * duplicated as `ORG_NAME_RE`/`TEAM_SLUG_RE` in backend-services).
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;

function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

function validateSlug(value: string): void {
  if (!isValidSlug(value)) {
    throw new Error('Invalid slug: must be 1-39 chars, alphanumeric with interior hyphens');
  }
}

export { SLUG_RE, isValidSlug, validateSlug };
