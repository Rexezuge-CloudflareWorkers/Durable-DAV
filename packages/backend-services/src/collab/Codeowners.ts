// Minimal CODEOWNERS parser: `pattern owner [owner...]`, `#` comments,
// last matching pattern wins (GitHub semantics simplified to `*` globs).
export interface CodeownerRule {
  pattern: string;
  owners: string[];
}

function patternToRegExp(pattern: string): RegExp {
  const p = pattern.trim().replace(/^\//, '');
  const escaped = p.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`);
}

function parseCodeowners(content: string): CodeownerRule[] {
  const rules: CodeownerRule[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const [pattern, ...owners] = parts;
    if (!pattern || owners.length === 0) continue;
    rules.push({ pattern, owners: owners.slice(0, 10) });
  }
  return rules.slice(0, 200);
}

function matchCodeowners(rules: readonly CodeownerRule[], path: string): string[] {
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  let best: CodeownerRule | null = null;
  for (const rule of rules) {
    const pattern = rule.pattern.startsWith('/') ? rule.pattern.slice(1) : rule.pattern;
    try {
      if (patternToRegExp(pattern).test(normalized) || patternToRegExp(pattern).test(`/${normalized}`)) best = rule;
    } catch {
      continue;
    }
    // Directory-prefix fallback: `docs/` owns `docs/a/b`.
    if (pattern.endsWith('/') && normalized.startsWith(pattern)) best = rule;
    // Basename fallback: `*.js` owns any nested `*.js`.
    if (pattern.startsWith('*.') && normalized.endsWith(pattern.slice(1))) best = rule;
  }
  return best?.owners ?? [];
}

export { matchCodeowners, parseCodeowners, normalizeCodeownerHandle, parseCodeownerTeam };

/**
 * Normalize a CODEOWNERS owner token to a resolvable username, or null when
 * the token cannot map to a single user (teams `org/team`, emails are passed
 * through by the caller, malformed tokens are skipped).
 */
function normalizeCodeownerHandle(raw: string): string | null {
  const handle = raw.trim();
  if (!handle || handle.includes('/')) return null;
  const stripped = handle.startsWith('@') ? handle.slice(1) : handle;
  if (!/^[\w.-]{1,100}$/.test(stripped)) return null;
  return stripped;
}

/**
 * Parse an `org/team` CODEOWNERS token (optionally `@`-prefixed) into its
 * org + team slugs, or null when the token is a plain user/email handle.
 * Previously such tokens were skipped entirely (normalize → null).
 */
function parseCodeownerTeam(raw: string): { org: string; team: string } | null {
  const handle = raw.trim().replace(/^@/, '');
  const parts = handle.split('/');
  if (parts.length !== 2) return null;
  const [org, team] = parts.map((p) => p.trim());
  if (!org || !team || !/^[\w.-]{1,100}$/.test(org) || !/^[\w.-]{1,100}$/.test(team)) return null;
  return { org, team };
}
