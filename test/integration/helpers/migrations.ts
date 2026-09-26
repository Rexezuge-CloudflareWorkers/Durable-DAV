/**
 * Minimal SQL statement splitter for SQLite migration files.
 *
 * Handles: single/double/backtick quoted strings (incl. `''` escapes),
 * `--` line comments, `/* ... *\/` block comments. Semicolons inside strings
 * or comments do not split. Skips comment-only statements.
 *
 * Trigger-aware: `CREATE TRIGGER ... BEGIN ...; ... END;` bodies contain
 * semicolons that must not split. The splitter tracks the outermost
 * BEGIN/END depth after a CREATE TRIGGER header and only splits on the
 * terminating semicolon after the final END.
 */

declare const __INTEGRATION_MIGRATION_SQL__: string;

function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;
  // CREATE TRIGGER body tracking (see header comment). Keywords are scanned
  // outside strings/comments only, matched as whole words case-insensitively.
  let inTrigger = false;
  let triggerDepth = 0;
  let word = '';
  const recentKeywords: string[] = [];
  const flushWord = (): void => {
    if (word.length === 0) return;
    const upper = word.toUpperCase();
    word = '';
    recentKeywords.push(upper);
    if (recentKeywords.length > 6) recentKeywords.shift();
    // `CREATE [TEMP|TEMPORARY] TRIGGER` opens a body; a table merely named
    // "trigger" (`CREATE TABLE trigger`) must not. The word before TRIGGER
    // disambiguates.
    if (upper === 'TRIGGER' && ['CREATE', 'TEMP', 'TEMPORARY'].includes(recentKeywords.at(-2) ?? '')) {
      inTrigger = true;
      triggerDepth = 0;
    } else if (inTrigger && upper === 'BEGIN') {
      triggerDepth += 1;
    } else if (inTrigger && upper === 'END') {
      triggerDepth -= 1;
      if (triggerDepth <= 0) {
        inTrigger = false;
        triggerDepth = 0;
      }
    }
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1] ?? '';

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === stringChar) {
        // SQL escapes a quote by doubling it ('it''s'); do not end the string.
        if (sql[i + 1] === stringChar) {
          current += sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i - 1] !== '\\') inString = false;
      }
      i++;
      continue;
    }
    // Buffer word characters for CREATE TRIGGER / BEGIN / END tracking.
    // Any other character ends the current word.
    if (/[\w$]/.test(ch)) {
      word += ch;
      current += ch;
      i++;
      continue;
    }
    flushWord();
    if (ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      stringChar = ch;
      current += ch;
      i++;
      continue;
    }
    if (ch === ';') {
      // Semicolons inside a trigger body do not terminate the statement.
      if (inTrigger) {
        current += ch;
        i++;
        continue;
      }
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

export async function applyMigrations(db: D1Database): Promise<void> {
  const statements = splitSql(__INTEGRATION_MIGRATION_SQL__);
  for (const stmt of statements) {
    if (stmt.length === 0) continue;
    // Skip pure-comment statements (no executable SQL).
    const withoutComments = stmt
      .replaceAll(/--[^\n]*/g, '')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    if (withoutComments.length === 0) continue;
    await db.prepare(stmt).run();
  }
}

export { splitSql };
