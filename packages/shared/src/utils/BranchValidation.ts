/**
 * Canonical git branch-name validator (Layer 0).
 *
 * Single source of truth consolidating the triplicated
 * `isValidBranchName` implementations previously copy-pasted across
 * `git-service/MergeService`, `git-service/RefService` (via import), and
 * `backend-services/pull/PullRequestService`.
 *
 * Rules mirror `git-check-ref-format` (simplified): no control chars,
 * no `~^:?*[@{[`, no `..`/`//`, no leading/trailing slash, max 255 chars.
 */
const BRANCH_SEGMENT_RE = /^[\w.-]+$/;

function hasIllegalBranchChar(branch: string): boolean {
  for (const ch of branch) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20) return true;
    if (code === 0x5c) return true;
    if ('~^:?*[@{['.includes(ch)) return true;
  }
  return false;
}

function isValidBranchName(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  if (branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.')) return false;
  if (branch.includes('..') || branch.includes('//')) return false;
  if (hasIllegalBranchChar(branch)) return false;
  return branch.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..' && seg !== '@' && BRANCH_SEGMENT_RE.test(seg));
}

export { BRANCH_SEGMENT_RE, hasIllegalBranchChar, isValidBranchName };
