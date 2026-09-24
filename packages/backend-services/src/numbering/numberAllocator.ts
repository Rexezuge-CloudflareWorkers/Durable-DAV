import type { NumberedEntity, NumberingDAO } from '@duradav/backend-data/dao';
import { isMissingSchemaError } from '@duradav/backend-data/utils';

/**
 * Allocate a per-repo number via the atomic `repo_number_counters` table,
 * falling back to the caller's legacy MAX+1 reader only for legacy DBs
 * (missing table) or unit fakes without the counters table.
 *
 * Fail-closed: any other allocator error (unknown entity, genuine D1
 * outage) is rethrown instead of being masked by a legacy read. A genuine
 * outage still surfaces — the legacy reader would fail too, but the
 * original allocator error is the accurate signal.
 *
 * The fallback is always safe: the 0019 UNIQUE(repository_id, number)
 * indexes plus the services' 3-attempt retry loops stay as the correctness
 * backstop, so the allocator is an optimization — never a new failure mode.
 */
async function allocateNumberWithFallback(
  numberingDAO: () => Promise<NumberingDAO>,
  legacyNextNumber: () => Promise<number>,
  repositoryId: string,
  entity: NumberedEntity,
): Promise<number> {
  try {
    const dao = await numberingDAO();
    return await dao.allocateNumber(repositoryId, entity);
  } catch (error) {
    // Legacy DBs (missing table) and unit fakes (`DB: {}` without
    // `prepare`) fall back to the legacy MAX+1 reader. Anything else
    // (unknown entity, genuine D1 outage) is rethrown fail-closed:
    // production `D1Queryable` always has `prepare`, so a missing
    // `prepare` unambiguously signals a test fake, never prod.
    // Why `isMissingSchemaError` + prepare-probe instead of a message regex:
    // the old `/no such table|...|prepare is not a function/` regex missed
    // `no such column` deploy skew and over-matched outage text containing
    // "counters". Central classifier keeps failure semantics in one place.
    if (isMissingSchemaError(error)) {
      return legacyNextNumber();
    }
    if (error instanceof TypeError && /prepare is not a function/i.test(error.message)) {
      return legacyNextNumber();
    }
    throw error;
  }
}

export { allocateNumberWithFallback };
