import { resolveAction } from './AuditActions';
import { AuditEventBuilder } from './AuditEventBuilder';
import type { AuditEvent } from './AuditEventBuilder';

const MAX_DETAIL_BYTES = 4096;

function getClientIp(request: Request): string | null {
  const headers = request.headers;
  const direct = headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim();
  return direct && direct.length > 0 ? direct.slice(0, 45) : null;
}

function truncateDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  if (detail.length <= MAX_DETAIL_BYTES) return detail;
  return detail.slice(0, MAX_DETAIL_BYTES);
}

// Owns request → event mapping (AccessBridge AuditPayloadBuilder pattern):
// action resolution, IP/UA extraction, resource inference from path.
// Org/repo id scoping is left null here — explicit callers (e.g. git push,
// which already resolved the repo row) pass ids; org reads match on the
// path-derived `resource` snapshots instead.
function buildRequestEvent(
  request: Request,
  userEmail: string,
  statusCode: number,
  input?: { orgId?: string | null; repoId?: string | null; resource?: string | null },
): AuditEvent {
  const url = new URL(request.url);
  const path = url.pathname;
  return new AuditEventBuilder()
    .userEmail((userEmail || 'unknown').toLowerCase())
    .action(resolveAction(request.method, path))
    .request(request.method.toUpperCase(), path)
    .status(statusCode)
    .resource(input?.resource ?? inferResource(path))
    .network(getClientIp(request), request.headers.get('user-agent')?.slice(0, 512) ?? null)
    .scope(input?.orgId ?? null, input?.repoId ?? null)
    .build();
}

function inferResource(path: string): string | null {
  // `/user/orgs/:org/...` → `org/:org`; `/user/repos/:owner/:repo/...` → `:owner/:repo`.
  const orgMatch = /^\/user\/orgs\/([^/]+)/.exec(path);
  if (orgMatch?.[1]) return `org/${decodeURIComponent(orgMatch[1])}`;
  const repoMatch = /^\/user\/repos\/([^/]+)\/([^/]+)/.exec(path) ?? /^\/repos\/([^/]+)\/([^/]+)/.exec(path);
  if (repoMatch?.[1] && repoMatch[2]) return `${decodeURIComponent(repoMatch[1])}/${decodeURIComponent(repoMatch[2])}`;
  const gitMatch = /^\/([^/]+)\/([^/]+)\/git-receive-pack$/.exec(path);
  if (gitMatch?.[1] && gitMatch[2]) return `${decodeURIComponent(gitMatch[1])}/${decodeURIComponent(gitMatch[2])}`;
  return null;
}

export { buildRequestEvent, truncateDetail, MAX_DETAIL_BYTES };
