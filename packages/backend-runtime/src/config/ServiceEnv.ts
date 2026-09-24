// Shared Edge-Git service env (Value Object).
// NOTE: DB / DO namespaces are intentionally `unknown` here — backend-runtime
// (Layer 1) must not import backend-data (Layer 2) or cloudflare:workers
// types. Narrow to D1Queryable / DurableObjectNamespace at use sites.
interface ServiceEnv {
  DB: unknown;
  REPO?: unknown;
  CRON_TASKS?: unknown;
  DEBUG_MODE?: string;
  DEV_AUTH_EMAIL?: string;
  DEMO_MODE?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  SITE_URL?: string;
  MAX_REPOS_PER_USER?: string;
  MAX_TOKENS_PER_USER?: string;
  MAX_TOKEN_EXPIRY_DAYS?: string;
  MAX_PACK_OBJECTS?: string;
  GIT_CACHE_TTL_SECONDS?: string;
  MAX_FETCH_WANTS?: string;
  MAX_FETCH_HAVES?: string;
  MAX_PUSH_COMMANDS?: string;
  MAX_PACK_BYTES?: string;
  MAX_FETCH_BODY_BYTES?: string;
  MAX_MERGE_DIFF_FILES?: string;
  MAX_RELEASES_PER_REPO?: string;
  MAX_ASSETS_PER_RELEASE?: string;
  MAX_ASSET_BYTES?: string;
  BACKGROUND_TASK_RUN_RETENTION_DAYS?: string;
  AUDIT_LOG_RETENTION_DAYS?: string;
  LOG_LEVEL?: string;
}

export type { ServiceEnv };
