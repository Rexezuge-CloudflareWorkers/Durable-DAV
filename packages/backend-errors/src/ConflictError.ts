import { ErrorCode, ServiceError } from './IServiceError';

class ConflictError extends ServiceError {
  constructor(message?: string) {
    super(message ?? 'The request conflicts with the current state of the resource.');
  }

  public getErrorCode(): ErrorCode {
    return 409;
  }

  public getErrorType(): string {
    return 'Conflict';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { ConflictError };
