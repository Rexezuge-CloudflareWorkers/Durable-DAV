import type { ServiceError, ErrorResponse } from '@durable-dav/backend-errors';
import { buildBody } from './ErrorMapper';

// Strategy: domain `ServiceError` → transport HTTP exception payload.
// Mirrors AWS `ErrorTranslationUtil`: JSON-stringified `{Exception:{Type,Message}}`
// so SELF fan-out / DO RPC boundaries preserve the typed contract.
function toHttpExceptionPayload(error: ServiceError): { status: number; body: ErrorResponse } {
  return { status: error.getErrorCode(), body: buildBody(error) };
}

function toHttpExceptionInit(error: ServiceError): { status: number; message: string } {
  const { status, body } = toHttpExceptionPayload(error);
  return { status, message: JSON.stringify(body) };
}

export { toHttpExceptionPayload, toHttpExceptionInit };
