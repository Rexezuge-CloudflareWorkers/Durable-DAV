import { ServiceError, DefaultInternalServerError } from '@duradav/backend-errors';
import type { ErrorResponse } from '@duradav/backend-errors';
import { getBackendStrings } from '@duradav/shared/i18n';

interface MappedError {
  status: number;
  body: ErrorResponse;
}

// Central error mapper (DIP): routes and DO handlers convert domain errors
// here instead of duplicating `instanceof ServiceError` switches or
// `.catch(()=>null)` existence-hiding. Private-resource hiding stays explicit
// via `hideExistence` / `failClosed`.
//
// Wire shape follows AWS `../AWS`: `{ "Exception": { "Type", "Message" } }`.
// Git smart-http pkt-line paths never serialize this envelope — they keep
// plain-text / `ERR` packets; only JSON APIs use it.
function buildBody(error: ServiceError): ErrorResponse {
  return { Exception: { Type: error.getErrorType(), Message: error.getErrorMessage() } };
}

function mapServiceError(error: unknown, locale?: string | null): MappedError {
  if (error instanceof ServiceError) {
    return { status: error.getErrorCode(), body: buildBody(error) };
  }
  const strings = getBackendStrings(locale ?? 'en');
  return {
    status: 500,
    body: {
      Exception: {
        Type: DefaultInternalServerError.getErrorType(),
        Message: strings.common.internalError,
      },
    },
  };
}

function toServiceStatus(error: unknown): 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 {
  const mapped = mapServiceError(error);
  // Registry over branching: known wire statuses pass through, everything
  // else (including 5xx typed errors) collapses to 500 for the JSON API.
  const KNOWN_STATUSES = new Set([400, 401, 403, 404, 409, 413, 429]);
  if (KNOWN_STATUSES.has(mapped.status)) return mapped.status as 400 | 401 | 403 | 404 | 409 | 413 | 429;
  return 500;
}

// Existence-hiding policy: private/missing resources map to null (caller → 404/401).
async function hideExistence<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// Fail-closed policy: auth/permission reads must never degrade to allow.
// Use for `TokenService` grant reads, `gitAuthForRepo` role checks, and
// push-protection resolution — errors propagate instead of becoming null.
async function failClosed<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

export { mapServiceError, toServiceStatus, hideExistence, failClosed, buildBody };
export type { MappedError };
