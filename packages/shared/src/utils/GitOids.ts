/**
 * Canonical zero-OID helpers (Layer 0).
 *
 * Why: `git-protocol/ProtectionPolicy` and `git-service/RefValidation`
 * each defined their own `isZeroOid` against the same `ZERO_OID`. Both now
 * re-export this single implementation so empty-repo / create / delete
 * semantics cannot drift.
 */
import { ZERO_OID } from '../constants/index';

function isZeroOid(value: unknown): boolean {
  return value === ZERO_OID;
}

export {  isZeroOid };

export {ZERO_OID} from '../constants/index';