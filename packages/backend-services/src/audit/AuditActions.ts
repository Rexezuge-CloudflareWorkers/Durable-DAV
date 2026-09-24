// METHOD + path-prefix → audit action map (AccessBridge AUDIT_ACTIONS pattern).
// First matching prefix wins; fallback is the raw `METHOD path`.
const AUDIT_ACTIONS: ReadonlyArray<{ method: string; prefix: string; action: string }> = [
  { method: 'POST', prefix: '/user/orgs', action: 'CREATE_ORG' },
  { method: 'PATCH', prefix: '/user/orgs', action: 'UPDATE_ORG' },
  { method: 'DELETE', prefix: '/user/orgs', action: 'DELETE_ORG' },
  { method: 'POST', prefix: '/user/repos', action: 'CREATE_REPO' },
  { method: 'PATCH', prefix: '/user/repos', action: 'UPDATE_REPO' },
  { method: 'DELETE', prefix: '/user/repos', action: 'DELETE_REPO' },
  { method: 'POST', prefix: '/user/issues', action: 'CREATE_ISSUE' },
  { method: 'PATCH', prefix: '/user/issues', action: 'UPDATE_ISSUE' },
  { method: 'POST', prefix: '/user/pulls', action: 'CREATE_PULL' },
  { method: 'PATCH', prefix: '/user/pulls', action: 'UPDATE_PULL' },
  { method: 'POST', prefix: '/user/tokens', action: 'CREATE_TOKEN' },
  { method: 'DELETE', prefix: '/user/tokens', action: 'REVOKE_TOKEN' },
  { method: 'POST', prefix: '/:owner/:repo/git-receive-pack', action: 'PUSH' },
];

function resolveAction(method: string, path: string): string {
  const upper = method.toUpperCase();
  for (const entry of AUDIT_ACTIONS) {
    if (entry.method === upper && (path === entry.prefix || path.startsWith(`${entry.prefix}/`) || path.startsWith(`${entry.prefix}?`))) {
      return entry.action;
    }
  }
  // PUSH is matched structurally (git paths are dynamic `/:owner/:repo/...`).
  if (upper === 'POST' && path.endsWith('/git-receive-pack')) return 'PUSH';
  return `${upper} ${path}`;
}

export { AUDIT_ACTIONS, resolveAction };
