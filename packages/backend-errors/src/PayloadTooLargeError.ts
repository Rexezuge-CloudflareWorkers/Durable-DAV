import { ErrorCode, ServiceError } from './IServiceError';

class PayloadTooLargeError extends ServiceError {
  constructor(message?: string) {
    super(message ?? 'The request payload is too large.');
  }

  public getErrorCode(): ErrorCode {
    return 413;
  }

  public getErrorType(): string {
    return 'PayloadTooLarge';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { PayloadTooLargeError };
