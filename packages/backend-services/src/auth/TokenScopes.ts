import { BadRequestError } from '@duradav/backend-errors';
import type { TokenScope } from '@duradav/shared';

const TOKEN_SCOPES: readonly TokenScope[] = ['repo:read', 'repo:write', 'admin'];

const DEFAULT_TOKEN_SCOPES: readonly TokenScope[] = ['repo:read', 'repo:write'];

// Scope hierarchy: `admin` implies `repo:write`, which implies `repo:read`.
// A token covers a requirement when it holds the required scope or any
// scope above it.
function coversScope(held: readonly TokenScope[], required: TokenScope): boolean {
  if (held.includes(required)) return true;
  if (required === 'repo:read') return held.includes('repo:write') || held.includes('admin');
  if (required === 'repo:write') return held.includes('admin');
  return false;
}

function normalizeTokenScopes(input: unknown): TokenScope[] {
  if (input === undefined || input === null) return [...DEFAULT_TOKEN_SCOPES];
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequestError(`scopes must be a non-empty subset of ${TOKEN_SCOPES.join(', ')}`);
  }
  const valid = input.filter((s): s is TokenScope => typeof s === 'string' && (TOKEN_SCOPES as readonly string[]).includes(s));
  if (valid.length !== input.length) {
    throw new BadRequestError(`scopes must be a non-empty subset of ${TOKEN_SCOPES.join(', ')}`);
  }
  return TOKEN_SCOPES.filter((s) => valid.includes(s));
}

export { TOKEN_SCOPES, DEFAULT_TOKEN_SCOPES, coversScope, normalizeTokenScopes };
