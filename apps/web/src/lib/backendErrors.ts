import { getBackendErrorType } from './api';

type TranslateFn = (key: string, fallback: string) => string;

const BACKEND_TYPE_TO_I18N_KEY: Record<string, string> = {
  BadRequest: 'errors.backend.badRequest',
  Unauthorized: 'errors.backend.unauthorized',
  Forbidden: 'errors.backend.forbidden',
  NotFound: 'errors.backend.notFound',
  Conflict: 'errors.backend.conflict',
  PayloadTooLarge: 'errors.backend.payloadTooLarge',
  RateLimited: 'errors.backend.rateLimited',
  MethodNotAllowed: 'errors.backend.methodNotAllowed',
  DatabaseError: 'errors.backend.databaseError',
  InternalServerError: 'errors.backend.internalError',
};

const BACKEND_TYPE_TO_FALLBACK: Record<string, string> = {
  BadRequest: 'Bad Request.',
  Unauthorized: 'Authentication Required.',
  Forbidden: 'Access Denied.',
  NotFound: 'Not Found.',
  Conflict: 'Conflict.',
  PayloadTooLarge: 'Payload Too Large.',
  RateLimited: 'Too Many Requests. Try Again Later.',
  MethodNotAllowed: 'Method Not Allowed.',
  DatabaseError: 'Service Temporarily Unavailable.',
  InternalServerError: 'Internal Server Error.',
};

/**
 * Maps a fetch failure to a localized user-facing message. Backend `Message`
 * values stay English on the wire by design, so typed `BackendError`s resolve
 * to `errors.backend.*` and every other failure falls back to the
 * operation-specific localized message — raw backend English never reaches
 * the notice bar.
 */
function toLocalizedErrorMessage(t: TranslateFn, error: unknown, fallbackKey: string, fallbackDefault: string): string {
  const type = getBackendErrorType(error);
  if (type) {
    const key = BACKEND_TYPE_TO_I18N_KEY[type];
    if (key) return t(key, BACKEND_TYPE_TO_FALLBACK[type] ?? fallbackDefault);
  }
  return t(fallbackKey, fallbackDefault);
}

export { BACKEND_TYPE_TO_FALLBACK, BACKEND_TYPE_TO_I18N_KEY, toLocalizedErrorMessage };
export type { TranslateFn };
