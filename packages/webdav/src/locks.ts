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
  for (const raw of timeoutHeader.split(',')) {
    const item = raw.trim();
    if (item.toLowerCase() === 'infinite') {
      return { timeout: 'Infinite', expiresAt: Date.now() + MAX_LOCK_TIMEOUT * 1000 };
    }
    const seconds = Number(/^Second-(\d+)$/i.exec(item)?.[1] ?? NaN);
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
  const conditions = parseIfHeader(request.headers.get('If'));
  for (const condition of conditions) {
    // Entity-tag conditions are not lock tokens; they are handled by the
    // conditional guard. The old regex treated `If: (<"etag">)` as a lock
    // token literally named `<"etag">`, so it never matched and the
    // conditional-PUT mechanism most desktop clients rely on did nothing.
    if (condition.kind === 'token') tokens.push(normalizeLockToken(condition.value));
  }
  return [...new Set(tokens.filter((t) => t !== '' && !t.toLowerCase().startsWith('dav:')))];
}

type IfCondition =
  | { kind: 'token'; value: string; negated: boolean }
  | { kind: 'etag'; value: string; negated: boolean }
  | { kind: 'no-lock'; negated: boolean }
  | { kind: 'unknown' };

/**
The characters `\s` covers, without building a regex.
*/
const IF_WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v']);

function isIfWhitespace(char: string | undefined): boolean {
  return char !== undefined && IF_WHITESPACE.has(char);
}

/**
 * Case-insensitive `not` at `index`, compared by char code so the scan does not
 * allocate a lowercase substring per group.
 */
function isNegationAt(header: string, index: number): boolean {
  // `| 0x20` is the ASCII case fold, and is false for every non-ASCII code
  // point, so it cannot fold a lookalike letter onto `not`.
  return (
    ((header.codePointAt(index) ?? 0) | 0x20) === 0x6e && // n
    ((header.codePointAt(index + 1) ?? 0) | 0x20) === 0x6f && // o
    ((header.codePointAt(index + 2) ?? 0) | 0x20) === 0x74 // t
  );
}

/**
 * Tokenizer for the RFC 4918 §10.4 `If` header grammar.
 *
 * ```
 * If             = "If" ":" ( 1*No-tag-list | 1*Tagged-list )
 * No-tag-list    = List
 * Tagged-list    = Resource-Tag 1*List
 * List           = "(" 1*Condition ")"
 * Condition      = ["Not"] ( State-token | "[" entity-tag "]" )
 * State-token    = Coded-URL
 * Coded-URL      = "<" absolute-URI ">"
 * ```
 *
 * The previous implementation was two `String.includes` calls. That inverted
 * §10.4.4 — the presence of `<DAV:no-lock>` anywhere, *including inside a
 * `Not`*, makes the whole header always-false, yet the old code reported
 * `Not <DAV:no-lock>` as *not* always-false. It was also case-sensitive, so
 * `<dav:no-lock>` was missed entirely.
 *
 * The grammar is read with an `indexOf` cursor rather than
 * `/\(\s*(Not\s+)?(<[^>]*>|\[[^\]]*\])/gi` (why: that regex is CodeQL
 * `js/polynomial-redos`, and it is a *real* quadratic, not a theoretical one —
 * `If: "[(".repeat(32768)` matched at every `(` and re-ran the `\[[^\]]*\]`
 * backtrack over the rest of the header each time, 3.6 s of isolate CPU from a
 * single 64 KB request. The V8 literal-prefix optimizer hides this on most
 * shapes, which is exactly why it survived review).
 *
 * Two rules keep the scan linear rather than merely replacing one quadratic
 * with another:
 *
 * - An unterminated `<`/`[` ends the scan. The cursor cannot advance past a
 *   closing bracket that does not exist, so continuing would re-scan the tail
 *   once per remaining `(` — the same O(n²) under a different name.
 * - Unreadable groups set one `unknown` flag instead of one entry per group,
 *   so `(((((…` cannot allocate 32k objects either.
 */
function parseIfHeader(ifHeader: string | null): IfCondition[] {
  if (!ifHeader) return [];
  const conditions: IfCondition[] = [];
  let unparseable = false;
  const length = ifHeader.length;
  let cursor = 0;
  while (cursor < length) {
    const open = ifHeader.indexOf('(', cursor);
    if (open === -1) break;
    let index = open + 1;
    while (isIfWhitespace(ifHeader[index])) index += 1;
    let negated = false;
    // `Not` must be followed by whitespace, exactly as the old `\s+` required.
    if (isNegationAt(ifHeader, index) && isIfWhitespace(ifHeader[index + 3])) {
      negated = true;
      index += 3;
      while (isIfWhitespace(ifHeader[index])) index += 1;
    }
    const opener = ifHeader[index];
    const close = opener === '<' ? ifHeader.indexOf('>', index + 1) : opener === '[' ? ifHeader.indexOf(']', index + 1) : -1;
    if (opener !== '<' && opener !== '[') {
      unparseable = true;
      cursor = open + 1;
      continue;
    }
    if (close === -1) {
      unparseable = true;
      break;
    }
    if (opener === '<') {
      const value = ifHeader.slice(index + 1, close);
      if (value.toLowerCase() === 'dav:no-lock') conditions.push({ kind: 'no-lock', negated });
      else conditions.push({ kind: 'token', value, negated });
    } else {
      conditions.push({ kind: 'etag', value: ifHeader.slice(index + 1, close).trim(), negated });
    }
    cursor = close + 1;
  }
  if (unparseable) conditions.push({ kind: 'unknown' });
  return conditions;
}

/**
 * True when the `If` header cannot be evaluated and must fail.
 *
 * `<DAV:no-lock>` is deliberately *not* treated as statically always-false. Per
 * §10.4.4 it "evaluates to false if the resource is locked, and true if it is
 * not" — so `If: (<DAV:no-lock>)` on an unlocked resource is a perfectly valid
 * request that must succeed. The previous implementation rejected exactly that
 * with 412, while *accepting* `Not <DAV:no-lock>` on a locked resource, which
 * is the inverse of the spec. Actual lock state is `DavLockGuard`'s job.
 *
 * What remains is a genuine fail-closed case: a header the grammar parser
 * could not read must not be silently ignored.
 */
function hasAlwaysFalseIfCondition(request: Request): boolean {
  const raw = request.headers.get('If');
  if (!raw) return false;
  const conditions = parseIfHeader(raw);
  // A non-empty header that yielded no conditions at all is unparseable.
  return conditions.length === 0 || conditions.some((c) => c.kind === 'unknown');
}

/**
Entity-tag conditions present in the `If` header, for the conditional guard.
*/
function getIfHeaderEtags(request: Request): Array<{ etag: string; negated: boolean }> {
  return parseIfHeader(request.headers.get('If'))
    .filter((c): c is { kind: 'etag'; value: string; negated: boolean } => c.kind === 'etag')
    .map((c) => ({ etag: c.value, negated: c.negated }));
}

/**
Constant-time comparison for equal-length byte arrays.
*/
function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index++) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export {
  DEFAULT_LOCK_TIMEOUT,
  MAX_LOCK_TIMEOUT,
  getSupportedLock,
  determineLockDepth,
  normalizeLockToken,
  normalizeLockDetails,
  getLockDiscovery,
  parseTimeout,
  getRequestLockTokens,
  hasAlwaysFalseIfCondition,
  getIfHeaderEtags,
  parseIfHeader,
  timingSafeEqual,
};
export type { LockDetails, IfCondition };
