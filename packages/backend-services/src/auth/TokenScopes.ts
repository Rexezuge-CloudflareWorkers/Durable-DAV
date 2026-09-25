import { BadRequestError } from '@durable-dav/backend-errors';
import type { TokenScope } from '@durable-dav/shared';

const TOKEN_SCOPES: readonly TokenScope[] = ['dav:read', 'dav:write', 'admin'];

const LEGACY_TOKEN_SCOPES: readonly TokenScope[] = ['repo:read', 'repo:write'];

const DEFAULT_TOKEN_SCOPES: readonly TokenScope[] = ['dav:read', 'dav:write'];

// Scope hierarchy: `admin` implies `dav:write`, which implies `dav:read`.
// Legacy `repo:read`/`repo:write` are aliases of the `dav:*` scopes.
function normalizeScopeAlias(scope: TokenScope): 'dav:read' | 'dav:write' | 'admin' {
  if (scope === 'repo:read') return 'dav:read';
  if (scope === 'repo:write') return 'dav:write';
  return scope;
}

// Scope hierarchy: `admin` implies `dav:write`, which implies `dav:read`.
// A token covers a requirement when it holds the required scope or any
// scope above it. Legacy `repo:*` inputs are treated as their `dav:*` alias.
function coversScope(held: readonly TokenScope[], required: TokenScope): boolean {
  const heldNormalized = new Set(held.map(normalizeScopeAlias));
  const requiredNormalized = normalizeScopeAlias(required);
  if (heldNormalized.has(requiredNormalized)) return true;
  if (requiredNormalized === 'dav:read') return heldNormalized.has('dav:write') || heldNormalized.has('admin');
  if (requiredNormalized === 'dav:write') return heldNormalized.has('admin');
  return false;
}

function normalizeTokenScopes(input: unknown): TokenScope[] {
  if (input === undefined || input === null) return [...DEFAULT_TOKEN_SCOPES];
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequestError(`scopes must be a non-empty subset of ${TOKEN_SCOPES.join(', ')}`);
  }
  const allowed = new Set<string>([...TOKEN_SCOPES, ...LEGACY_TOKEN_SCOPES]);
  const valid = (input as unknown[]).filter((s): s is TokenScope => typeof s === 'string' && allowed.has(s));
  if (valid.length !== (input as unknown[]).length) {
    throw new BadRequestError(`scopes must be a non-empty subset of ${TOKEN_SCOPES.join(', ')}`);
  }
  const normalized = valid.map(normalizeScopeAlias);
  return TOKEN_SCOPES.filter((s) => (normalized as string[]).includes(s));
}

export { TOKEN_SCOPES, LEGACY_TOKEN_SCOPES, DEFAULT_TOKEN_SCOPES, coversScope, normalizeTokenScopes, normalizeScopeAlias };
