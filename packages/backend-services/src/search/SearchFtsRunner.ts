/**
 * FTS-primary / LIKE-secondary search strategy (Strategy pattern).
 *
 * Tries the FTS query first, then falls back to LIKE. A missing-schema
 * error on either layer means the index was never migrated → `[]`
 * (fail-open read-model). Any other LIKE failure rethrows so genuine D1
 * errors fail closed instead of masking behind an empty result.
 */
async function ftsOrLike<T>(fts: () => Promise<T[]>, like: () => Promise<T[]>, isMissingSchema: (error: unknown) => boolean): Promise<T[]> {
  try {
    return await fts();
  } catch {
    // Intentionally drop the FTS error: LIKE is the compatibility path and
    // its own error (or rows) is the actionable signal.
  }
  try {
    return await like();
  } catch (likeError) {
    if (isMissingSchema(likeError)) return [];
    throw likeError;
  }
}

export { ftsOrLike };
