import { InternalServerError } from './InternalServerError';

class DatabaseError extends InternalServerError {
  constructor(message?: string, retryable: boolean = false, options?: { cause?: unknown }) {
    super(message ?? 'The system encountered an unexpected problem while accessing the database.', options);
    this.retryable = retryable;
  }

  public override getErrorType(): string {
    return 'DatabaseError';
  }
}

export { DatabaseError };
