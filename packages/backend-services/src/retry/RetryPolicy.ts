const DEFAULT_BACKOFF_SECONDS = [60, 600, 3600, 21_600, 86_400] as const;

interface RetryPolicy {
  isRetryable(status: number | null): boolean;
  backoffSeconds(attempt: number): number;
}

function createExponentialRetryPolicy(schedule: readonly number[] = DEFAULT_BACKOFF_SECONDS): RetryPolicy {
  return {
    isRetryable: (status) => (status === null ? true : status === 429 || (status >= 500 && status <= 599)),
    backoffSeconds: (attempt) => schedule[Math.min(Math.max(attempt, 1), schedule.length) - 1],
  };
}

const sharedRetryPolicy: RetryPolicy = createExponentialRetryPolicy();

export { createExponentialRetryPolicy, sharedRetryPolicy, DEFAULT_BACKOFF_SECONDS };
export type { RetryPolicy };
