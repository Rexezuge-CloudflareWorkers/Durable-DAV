import { escapeXml } from './path';

type LockDetails = {
  token: string;
  owner: string | undefined;
  scope: 'exclusive' | 'shared';
  depth: '0' | 'infinity';
  timeout: string;
  expiresAt: number;
  root: string;
};

const DEFAULT_LOCK_TIMEOUT = 3600;
const MAX_LOCK_TIMEOUT = 365 * 24 * 60 * 60;
const VALID_LOCK_DEPTHS = ['0', 'infinity'] as const;

function getSupportedLock(): string {
  return [
    '<lockentry><lockscope><exclusive /></lockscope><locktype><write /></locktype></lockentry>',
    '<lockentry><lockscope><shared /></lockscope><locktype><write /></locktype></lockentry>',
  ].join('');
}

function determineLockDepth(resourceIsCollection: boolean, depthHeader: '0' | 'infinity' | null): '0' | 'infinity' {
  if (resourceIsCollection) return depthHeader ?? 'infinity';
  return depthHeader === 'infinity' ? 'infinity' : '0';
}

function normalizeLockToken(lockToken: string): string {
  return lockToken
    .trim()
    .replaceAll(/^<|>$/g, '')
    .replace(/^(?:urn:uuid:|opaquelocktoken:)/, '');
}

function normalizeLockDetails(lockDetails: Partial<LockDetails> & Pick<LockDetails, 'token'>): LockDetails | null {
  let expiresAt = Number(lockDetails.expiresAt ?? 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    expiresAt = Date.now() + DEFAULT_LOCK_TIMEOUT * 1000;
  }
  if (expiresAt <= Date.now()) return null;
  return {
    token: lockDetails.token,
    owner: lockDetails.owner,
    scope: lockDetails.scope === 'shared' ? 'shared' : 'exclusive',
    depth: lockDetails.depth === 'infinity' ? 'infinity' : '0',
    timeout: lockDetails.timeout ?? `Second-${DEFAULT_LOCK_TIMEOUT}`,
    expiresAt,
    root: lockDetails.root ?? '/',
  };
}

function getLockDiscovery(lockDetails: LockDetails | LockDetails[]): string {
  const list = Array.isArray(lockDetails) ? lockDetails : [lockDetails];
  return list
    .map(
      (d) =>
        `<activelock><locktype><write /></locktype><lockscope><${d.scope} /></lockscope><depth>${d.depth}</depth>${d.owner ? `<owner>${escapeXml(d.owner)}</owner>` : ''}<timeout>${escapeXml(d.timeout)}</timeout><locktoken><href>urn:uuid:${escapeXml(d.token)}</href></locktoken><lockroot><href>${escapeXml(d.root)}</href></lockroot></activelock>`,
    )
    .join('');
}

function parseTimeout(timeoutHeader: string | null): { timeout: string; expiresAt: number } {
  if (timeoutHeader === null) {
    return { timeout: `Second-${DEFAULT_LOCK_TIMEOUT}`, expiresAt: Date.now() + DEFAULT_LOCK_TIMEOUT * 1000 };
  }
  for (const item of timeoutHeader.split(',').map((v) => v.trim())) {
    if (item.toLowerCase() === 'infinite') {
      return { timeout: 'Infinite', expiresAt: Date.now() + MAX_LOCK_TIMEOUT * 1000 };
    }
    const seconds = Number(item.match(/^Second-(\d+)$/i)?.[1] ?? NaN);
    if (Number.isFinite(seconds) && seconds > 0) {
      const clamped = Math.min(seconds, MAX_LOCK_TIMEOUT);
      return { timeout: `Second-${clamped}`, expiresAt: Date.now() + clamped * 1000 };
    }
  }
  return { timeout: `Second-${DEFAULT_LOCK_TIMEOUT}`, expiresAt: Date.now() + DEFAULT_LOCK_TIMEOUT * 1000 };
}

function getRequestLockTokens(request: Request): string[] {
  const tokens: string[] = [];
  const direct = request.headers.get('Lock-Token');
  if (direct) tokens.push(normalizeLockToken(direct));
  const ifHeader = request.headers.get('If');
  if (ifHeader) {
    for (const match of ifHeader.matchAll(/<([^>]+)>/g)) {
      const token = normalizeLockToken(match[1]);
      if (token !== '') tokens.push(token);
    }
  }
  return [...new Set(tokens)];
}

function hasAlwaysFalseIfCondition(request: Request): boolean {
  const ifHeader = request.headers.get('If') ?? '';
  return ifHeader.includes('<DAV:no-lock>') && !ifHeader.includes('Not <DAV:no-lock>');
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index++) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export {
  DEFAULT_LOCK_TIMEOUT,
  MAX_LOCK_TIMEOUT,
  VALID_LOCK_DEPTHS,
  getSupportedLock,
  determineLockDepth,
  normalizeLockToken,
  normalizeLockDetails,
  getLockDiscovery,
  parseTimeout,
  getRequestLockTokens,
  hasAlwaysFalseIfCondition,
  timingSafeEqual,
};
export type { LockDetails };
