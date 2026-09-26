import { ServiceError, DefaultInternalServerError } from '@durable-dav/backend-errors';
import type { ErrorResponse } from '@durable-dav/backend-errors';
import { getBackendStrings } from '@durable-dav/shared/i18n';

interface MappedError {
  status: number;
  body: ErrorResponse;
}

// Central error mapper (DIP): routes and DO handlers convert domain errors
// here instead of duplicating `instanceof ServiceError` switches.
//
// Wire shape follows AWS `../AWS`: `{ "Exception": { "Type", "Message" } }`.
// Only JSON APIs use it; WebDAV responses stay plain-text per RFC 4918.
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
  return KNOWN_STATUSES.has(mapped.status) ? (mapped.status as 400 | 401 | 403 | 404 | 409 | 413 | 429) : 500;
}

export { mapServiceError, toServiceStatus };
export type { MappedError };
