/**
 * Capped request-body reading.
 *
 * Why this exists: `await request.arrayBuffer()` followed by a length check is
 * not a limit. The body is fully materialised *before* the check runs, so a
 * client sending more than the cap is OOM-killed (Workers cap memory at
 * 128 MB) rather than receiving `413`. `request.clone()` is worse still — it
 * tees the stream, buffering the payload twice.
 *
 * The declared `Content-Length` is checked first as a cheap early exit (it is
 * advisory: a chunked request omits it), then the stream is read with a running
 * total so an undeclared oversize body is also bounded.
 */

/**
Largest XML request body accepted by PROPFIND/PROPPATCH/LOCK/UNLOCK.
*/
const MAX_XML_BODY_BYTES = 64 * 1024;

type BodyReadResult = { ok: true; bytes: ArrayBuffer } | { ok: false; reason: 'too-large' };

/**
True when the declared `Content-Length` already exceeds `maxBytes`.
*/
function exceedsDeclaredLength(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get('Content-Length');
  if (raw === null) return false;
  const declared = Number(raw);
  // A non-numeric or absent value means "unknown" — the streaming read below
  // is what actually enforces the cap.
  return Number.isFinite(declared) && declared > maxBytes;
}

/**
 * Read at most `maxBytes` from `request`, reporting `too-large` instead of
 * buffering the overflow.
 */
async function readCappedBody(request: Request, maxBytes: number): Promise<BodyReadResult> {
  if (exceedsDeclaredLength(request, maxBytes)) return { ok: false, reason: 'too-large' };
  const body = request.body;
  // No body (GET/HEAD/DELETE) or a fully-buffered request: `arrayBuffer` is
  // already bounded by the platform, and there is nothing to stream.
  if (body === null) {
    const bytes = await request.arrayBuffer();
    return bytes.byteLength > maxBytes ? { ok: false, reason: 'too-large' } : { ok: true, bytes };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) {
      continue;
    }

    total += value.byteLength;
    if (total > maxBytes) {
      // Stop pulling; the caller answers 413 without waiting for the rest.
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: 'too-large' };
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: out.buffer };
}

/**
Decode a capped body as UTF-8 text.
*/
async function readCappedText(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; reason: 'too-large' }> {
  const result = await readCappedBody(request, maxBytes);
  return result.ok ? { ok: true, text: new TextDecoder().decode(result.bytes) } : result;
}

export { MAX_XML_BODY_BYTES, readCappedBody, readCappedText, exceedsDeclaredLength };
export type { BodyReadResult };
