import { ErrorCode, ServiceError } from './IServiceError';

class RateLimitedError extends ServiceError {
  constructor(message?: string) {
    super(message ?? 'Rate limit exceeded; try again later.');
  }

  public getErrorCode(): ErrorCode {
    return 429;
  }

  public getErrorType(): string {
    return 'RateLimited';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { RateLimitedError };
