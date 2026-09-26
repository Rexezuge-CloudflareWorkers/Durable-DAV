import {
  BadRequestError,
  DatabaseError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from '@durable-dav/backend-errors';
import type { ServiceError, ErrorResponse } from '@durable-dav/backend-errors';

// Strategy: `Response` carrying `{Exception:{Type,Message}}` → typed `ServiceError`.
// Mirrors AWS `ErrorDeserializationUtil`; unknown types degrade to
// `InternalServerError` so callers never receive untyped errors.
function deserializeErrorBody(data: ErrorResponse | null | undefined, fallback: string): ServiceError {
  const type = data?.Exception?.Type ?? 'InternalServerError';
  const message = data?.Exception?.Message ?? fallback;
  switch (type) {
    case 'BadRequest': {
      return new BadRequestError(message);
    }
    case 'Unauthorized': {
      return new UnauthorizedError(message);
    }
    case 'Forbidden': {
      return new ForbiddenError(message);
    }
    case 'NotFound': {
      return new NotFoundError(message);
    }
    case 'DatabaseError': {
      return new DatabaseError(message);
    }
    default: {
      return new InternalServerError(message);
    }
  }
}


// Lenient parser for web-compat: accepts AWS envelope, legacy
// `{error,message}`, and plain-text bodies.
function parseErrorPayload(payload: unknown, httpStatus: number): ServiceError {
  if (typeof payload === 'string') {
    if (payload.length === 0) return new InternalServerError(`HTTP ${httpStatus}`);
    try {
      return parseErrorPayload(JSON.parse(payload) as unknown, httpStatus);
    } catch {
      return new InternalServerError(payload);
    }
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const exception = record['Exception'] as { Type?: string; Message?: string } | undefined;
    if (exception && (typeof exception.Type === 'string' || typeof exception.Message === 'string')) {
      return deserializeErrorBody({ Exception: exception }, `HTTP ${httpStatus}`);
    }
    const legacyError = typeof record['error'] === 'string' ? record['error'] : undefined;
    const legacyMessage = typeof record['message'] === 'string' ? record['message'] : undefined;
    if (legacyError || legacyMessage) {
      return deserializeErrorBody(
        { Exception: { Type: legacyError ?? 'InternalServerError', Message: legacyMessage ?? legacyError ?? `HTTP ${httpStatus}` } },
        `HTTP ${httpStatus}`,
      );
    }
  }
  return new InternalServerError(`HTTP ${httpStatus}`);
}

export { deserializeErrorBody, parseErrorPayload };
