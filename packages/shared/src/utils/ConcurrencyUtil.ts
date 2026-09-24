/**
 * Bounded parallel mapper (Layer 0).
 *
 * Why shared: `RefService` and `ReadModelService` carried verbatim copies;
 * tag/branch bombs otherwise fan out into unbounded git I/O in the DO.
 * Single canonical implementation keeps the fan-out discipline in one place.
 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = Array.from({ length: items.length }, () => undefined as R);
  let next = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item: T | undefined = items[index];
      if (item !== undefined) out[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return out;
}

export { mapWithConcurrency };
