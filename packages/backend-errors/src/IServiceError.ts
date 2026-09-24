// Layer 0 stays dependency-free: HTTP status codes are plain numbers.
// Previously typed as `ContentfulStatusCode` from `hono`, which pulled a
// framework dependency into the base error layer.
abstract class ServiceError extends Error {
  public retryable: boolean = false;

  public abstract getErrorCode(): number;

  public abstract getErrorType(): string;

  public abstract getErrorMessage(): string;
}

// eslint-disable-next-line sonarjs/redundant-type-aliases -- kept for backward compat with `ErrorCode` imports.
type ErrorCode = number;

export { ServiceError };
export type { ErrorCode };
