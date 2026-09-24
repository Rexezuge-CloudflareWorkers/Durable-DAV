const RETRYABLE_PATTERNS: RegExp[] = [
  /busy/i,
  /locked/i,
  /timeout/i,
  /timed?\s*out/i,
  /internal\s+(server\s+)?error/i,
  /connection/i,
  /network/i,
  /unavailable/i,
  /throttl/i,
  /too\s+many/i,
  /retry/i,
  /deadlock/i,
  /serialization/i,
];

const NON_RETRYABLE_PATTERNS: RegExp[] = [
  /constraint/i,
  /unique/i,
  /primary\s+key/i,
  /foreign\s+key/i,
  /not\s+found/i,
  /syntax/i,
  /parse\s+error/i,
  /no\s+such\s+(table|column|index)/i,
  /type\s+mismatch/i,
  /range/i,
  /permission/i,
  /authorization/i,
  /authentication/i,
  /invalid\s+argument/i,
];

function isD1ErrorRetryable(errorMessage: string): boolean {
  if (!errorMessage) return false;

  for (const pattern of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(errorMessage)) return false;
  }

  for (const pattern of RETRYABLE_PATTERNS) {
    if (pattern.test(errorMessage)) return true;
  }

  return false;
}

// Fail-closed helper (hardening): distinguishes "unit fake missing a table
// or column" (safe to degrade to [] / fallback query) from genuine D1
// failures (must propagate as DatabaseError, never silent []). Production
// D1 always carries the full baseline schema (0021+); the classifier now
// guards fake-DB shapes and deploy skew, not legacy migrations.
// Callers must only swallow `true` here; everything else rethrows.
function isMissingSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /no\s+such\s+(?:table|column|index)/i.test(message);
}

export { isD1ErrorRetryable, isMissingSchemaError };
