/**
 * Content negotiation for the volume-root document route.
 *
 * Extracted from `DurableDavWorker` so it can be unit-tested without pulling in
 * the generated SPA shell and the Chanfana OpenAPI proxy.
 */

type Candidate = { type: string; quality: number };

const HTML = 'text/html';

/**
Media types a browser may send when it is asking for a document.
*/
const HTML_DOCUMENT_TYPES: ReadonlySet<string> = new Set([HTML, 'application/xhtml+xml']);

/**
Does this media range denote an HTML document?

Covers the exact document types plus type wildcards that contain them
(`text/*`). A range that is both must not also be counted as an alternative,
or `text/*` alone scores 1 on both sides and ties.
*/
function isHtmlRange(type: string): boolean {
  if (HTML_DOCUMENT_TYPES.has(type)) return true;
  if (!type.endsWith('/*') || type.startsWith('*')) return false;
  const prefix = type.slice(0, -1);
  return [...HTML_DOCUMENT_TYPES].some((doc) => doc.startsWith(prefix));
}

/**
Parse `Accept` into media ranges, dropping malformed entries.
*/
function parseAccept(header: string): Candidate[] {
  const out: Candidate[] = [];
  for (const part of header.split(',')) {
    const segments = part.split(';');
    const type = (segments[0] ?? '').trim().toLowerCase();
    if (type === '') continue;
    const qParam = segments
      .slice(1)
      .map((p) => p.trim())
      .find((p) => p.toLowerCase().startsWith('q='));
    const parsed = qParam ? Number(qParam.slice(2)) : 1;
    out.push({ type, quality: Number.isFinite(parsed) ? parsed : 0 });
  }
  return out;
}

/**
 * Quality the client assigns to `target`, honouring RFC 7231 §5.3.2
 * specificity: an exact match beats a type wildcard, which beats the
 * catch-all wildcard.
 *
 * This matters because a concrete `text/html;q=0` must not be resurrected by a
 * broader `*` wildcard at q=0.5 — the more specific range is the one that
 * governs.
 */
function governingQuality(candidates: readonly Candidate[], target: string): number {
  const exact = candidates.find((c) => c.type === target);
  if (exact) return exact.quality;
  const wildcard = candidates.find((c) => c.type.endsWith('/*') && target.startsWith(c.type.slice(0, -1)));
  return wildcard ? wildcard.quality : (candidates.find((c) => c.type === '*/*')?.quality ?? 0);
}

/**
 * True when the client prefers an HTML document over the WebDAV
 * representation.
 *
 * A substring test for `text/html` was wrong three ways: `Accept: text/html;q=0`
 * (an explicit refusal) still matched; `text/html;q=0.1, application/xml;q=0.9`
 * matched despite XML winning on quality; and any DAV client that merely *lists*
 * `text/html` among many accepted types was served the SPA shell instead of a
 * multistatus listing.
 *
 * HTML is served only when the client explicitly named a document type, that
 * type is not refused, and its quality strictly beats the best alternative we
 * would otherwise send. A bare catch-all wildcard states no preference either
 * way, so the WebDAV representation wins — which is what curl and DAV clients
 * send.
 */
function acceptsHtml(request: Request): boolean {
  const header = request.headers.get('Accept');
  if (!header) return false;
  const candidates = parseAccept(header);
  const explicitlyWantsHtml = candidates.some((c) => isHtmlRange(c.type));
  if (!explicitlyWantsHtml) return false;

  const htmlQuality = Math.max(...[...HTML_DOCUMENT_TYPES].map((type) => governingQuality(candidates, type)));
  if (htmlQuality <= 0) return false;

  const otherQuality = candidates.filter((c) => !isHtmlRange(c.type)).reduce((best, c) => Math.max(best, c.quality), 0);
  return htmlQuality > otherQuality;
}

export { acceptsHtml };
