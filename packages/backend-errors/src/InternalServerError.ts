import { ErrorCode, ServiceError } from './IServiceError';

interface ErrorCauseOptions {
  cause?: unknown;
}

class InternalServerError extends ServiceError {
  constructor(message?: string, options?: ErrorCauseOptions) {
    super(message ?? 'The server encountered an internal error and was unable to complete your request.');
    // Preserve the causal chain (why: `String(error)` in catch blocks dropped
    // stacks, making D1 outages undebuggable). `cause` is enumerable via
    // `error.cause` on modern runtimes; assignment keeps compat with older lib targets.
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  public getErrorCode(): ErrorCode {
    return 500;
  }

  public getErrorType(): string {
    return 'InternalServerError';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

const DefaultInternalServerError = new InternalServerError();

export { InternalServerError, DefaultInternalServerError };
