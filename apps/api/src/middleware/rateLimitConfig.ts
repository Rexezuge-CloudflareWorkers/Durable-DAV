import type { Hono } from 'hono';
import { rateLimit } from './rateLimit';

interface RateLimitDef {
  path: string;
  windowMs: number;
  max: number;
  keyPrefix: string;
}

/**
 * Table-driven rate-limit registry (AWS/Otter `route-helpers` pattern).
 *
 * Previously 30+ copy-pasted `app.use(path, rateLimit(...))` calls lived
 * inline in `DuraDavWorker`, making tuning and auditing error-prone. All
 * buckets stay per-isolate token buckets; cron/DOs remain the cross-isolate
 * backstop. Edit this table — not the worker — to tune limits.
 */
const RATE_LIMIT_DEFS: readonly RateLimitDef[] = [
  { path: '/:owner/:repo/git-upload-pack', windowMs: 60_000, max: 60, keyPrefix: 'git-fetch' },
  { path: '/:owner/:repo/git-receive-pack', windowMs: 60_000, max: 60, keyPrefix: 'git-push' },
  { path: '/:owner/:repo/info/refs', windowMs: 60_000, max: 120, keyPrefix: 'git-refs' },
  { path: '/user/tokens*', windowMs: 60_000, max: 30, keyPrefix: 'tokens' },
  { path: '/user/realtime/*', windowMs: 60_000, max: 60, keyPrefix: 'realtime' },
  { path: '/user/repos', windowMs: 60_000, max: 30, keyPrefix: 'repo-create' },
  { path: '/search', windowMs: 60_000, max: 120, keyPrefix: 'search' },
  { path: '/users/*', windowMs: 60_000, max: 120, keyPrefix: 'public-users' },
  { path: '/repos/*', windowMs: 60_000, max: 300, keyPrefix: 'public-repos' },
  { path: '/user/me/username', windowMs: 60_000, max: 10, keyPrefix: 'username-rename' },
  { path: '/user/orgs*', windowMs: 60_000, max: 60, keyPrefix: 'org-mutate' },
  { path: '/user/repos/:owner/:repo/import*', windowMs: 60_000, max: 10, keyPrefix: 'import' },
  { path: '/user/repos/:owner/:repo/mirror*', windowMs: 60_000, max: 20, keyPrefix: 'mirror' },
  { path: '/user/repos/:owner/:repo/hooks*', windowMs: 60_000, max: 30, keyPrefix: 'webhook-mutate' },
  { path: '/user/repos/:owner/:repo/contents*', windowMs: 60_000, max: 60, keyPrefix: 'file-write' },
  { path: '/user/repos/:owner/:repo/issues*', windowMs: 60_000, max: 120, keyPrefix: 'issues' },
  { path: '/user/repos/:owner/:repo/pulls*', windowMs: 60_000, max: 120, keyPrefix: 'pulls' },
  { path: '/user/repos/:owner/:repo/comments*', windowMs: 60_000, max: 120, keyPrefix: 'comments' },
  { path: '/user/audit*', windowMs: 60_000, max: 60, keyPrefix: 'audit-read' },
  { path: '/user/orgs/*/audit*', windowMs: 60_000, max: 60, keyPrefix: 'audit-org' },
  { path: '/user/notifications*', windowMs: 60_000, max: 120, keyPrefix: 'notifications' },
  { path: '/user/repos/:owner/:repo/branches*', windowMs: 60_000, max: 120, keyPrefix: 'branches' },
  { path: '/user/repos/:owner/:repo/rules*', windowMs: 60_000, max: 60, keyPrefix: 'rules' },
  { path: '/user/repos/:owner/:repo/collaborators*', windowMs: 60_000, max: 60, keyPrefix: 'collabs' },
  { path: '/user/repos/:owner/:repo/checks*', windowMs: 60_000, max: 120, keyPrefix: 'checks' },
  { path: '/user/repos/:owner/:repo/keys*', windowMs: 60_000, max: 60, keyPrefix: 'deploy-keys' },
  { path: '/user/repos/:owner/:repo/releases*', windowMs: 60_000, max: 120, keyPrefix: 'releases' },
  { path: '/user/repos/:owner/:repo/projects*', windowMs: 60_000, max: 120, keyPrefix: 'projects' },
  { path: '/user/repos/:owner/:repo/discussions*', windowMs: 60_000, max: 120, keyPrefix: 'discussions' },
  { path: '/user/repos/:owner/:repo/wiki*', windowMs: 60_000, max: 120, keyPrefix: 'wiki' },
  { path: '/user/repos/:owner/:repo/snippets*', windowMs: 60_000, max: 120, keyPrefix: 'snippets' },
  { path: '/user/repos/:owner/:repo/labels*', windowMs: 60_000, max: 120, keyPrefix: 'labels' },
  { path: '/user/repos/:owner/:repo/milestones*', windowMs: 60_000, max: 120, keyPrefix: 'milestones' },
  { path: '/user/repos/:owner/:repo/threads*', windowMs: 60_000, max: 120, keyPrefix: 'threads' },
  { path: '/user/repos/:owner/:repo/reviews*', windowMs: 60_000, max: 120, keyPrefix: 'reviews' },
  { path: '/user/repos/:owner/:repo/fork*', windowMs: 60_000, max: 30, keyPrefix: 'fork' },
  { path: '/user/repos/:owner/:repo/star*', windowMs: 60_000, max: 120, keyPrefix: 'social-mutate' },
  { path: '/user/repos/:owner/:repo/watch*', windowMs: 60_000, max: 120, keyPrefix: 'social-mutate' },
  { path: '/user/stars*', windowMs: 60_000, max: 120, keyPrefix: 'social-read' },
  { path: '/user/watches*', windowMs: 60_000, max: 120, keyPrefix: 'social-read' },
];

function registerRateLimits(app: Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>): void {
  for (const def of RATE_LIMIT_DEFS) {
    app.use(def.path, rateLimit({ windowMs: def.windowMs, max: def.max, keyPrefix: def.keyPrefix }));
  }
}

function registerGitRateLimits(app: Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>): void {
  for (const def of RATE_LIMIT_DEFS.slice(0, 3)) {
    app.use(def.path, rateLimit({ windowMs: def.windowMs, max: def.max, keyPrefix: def.keyPrefix }));
  }
}

function registerUserRateLimits(app: Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>): void {
  for (const def of RATE_LIMIT_DEFS.slice(3)) {
    app.use(def.path, rateLimit({ windowMs: def.windowMs, max: def.max, keyPrefix: def.keyPrefix }));
  }
}

export { RATE_LIMIT_DEFS, registerRateLimits, registerGitRateLimits, registerUserRateLimits };
export type { RateLimitDef };
