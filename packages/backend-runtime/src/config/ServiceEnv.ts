// Shared Durable-DAV service env (Value Object).
// NOTE: DB / DO namespaces are intentionally `unknown` here — backend-runtime
// (Layer 1) must not import backend-data (Layer 2) or cloudflare:workers
// types. Narrow to D1Queryable / DurableObjectNamespace at use sites.
interface ServiceEnv {
  DB: unknown;
  DAV_VOLUME?: unknown;
  CRON_TASKS?: unknown;
  CACHE?: unknown;
  DEBUG_MODE?: string;
  ENVIRONMENT?: string;
  DEV_AUTH_EMAIL?: string;
  DEMO_MODE?: string;
  DEMO_USER_EMAIL?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  SITE_URL?: string;
  MAX_VOLUMES_PER_USER?: string;
  MAX_CREDENTIALS_PER_VOLUME?: string;
  DEFAULT_CREDENTIAL_EXPIRY_DAYS?: string;
  MAX_CREDENTIAL_EXPIRY_DAYS?: string;
  MAX_FILE_BYTES?: string;
  DO_DEVICE_BYTES?: string;
  DAV_CACHE_TTL_SECONDS?: string;
  /**
  @deprecated Git-template leftover; `DAV_CACHE_TTL_SECONDS` wins when set.
  */
  GIT_CACHE_TTL_SECONDS?: string;
  LOG_LEVEL?: string;
}

export type { ServiceEnv };
