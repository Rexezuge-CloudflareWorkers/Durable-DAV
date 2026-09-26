// Pure HTTP Range parser (why: `handleGet` mixed Range math with I/O, which
// made suffix/open-ended edge cases untestable and easy to regress).

interface ParsedRange {
  offset: number;
  length: number | undefined;
  contentRange: string | undefined;
  status: 200 | 206 | 416;
}

const FULL_BODY: ParsedRange = { offset: 0, length: undefined, contentRange: undefined, status: 200 };

// Anchored on purpose. The previous unanchored `/bytes=(\d*)-(\d*)/` matched
// inside `notbytes=0-5` and accepted trailing junk such as `bytes=0-5junk`.
const RANGE_RE = /^\s*bytes=(\d*)-(\d*)\s*$/i;

function unsatisfiable(size: number): ParsedRange {
  // RFC 7233 §4.4: a syntactically valid but unsatisfiable range is 416 with
  // `Content-Range: bytes */size`, not a silent full-body 200. Returning 200
  // made clients believe they had the whole representation.
  return { offset: 0, length: undefined, contentRange: `bytes */${size}`, status: 416 };
}

function parseRangeHeader(rangeHeader: string | null, size: number): ParsedRange {
  if (!rangeHeader) return FULL_BODY;
  // Empty files have no satisfiable range. There is nothing to report, so a
  // full-body 200 is the only answer that is not also a lie.
  if (!Number.isSafeInteger(size) || size <= 0) return FULL_BODY;
  const match = RANGE_RE.exec(rangeHeader);
  // Unparseable → ignore the header (RFC 7233 §4.2).
  if (!match) return FULL_BODY;
  // Multipart ranges are not supported; serving only the first range would be
  // a silent data-loss bug for a client that asked for two.
  if (rangeHeader.includes(',')) return FULL_BODY;

  const startText = match[1] ?? '';
  const endText = match[2] ?? '';

  if (startText === '') {
    // Suffix range: `bytes=-N` is the final N bytes.
    if (endText === '') return FULL_BODY;
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return unsatisfiable(size);
    const offset = Math.max(0, size - suffix);
    const length = size - offset;
    return { offset, length, contentRange: `bytes ${offset}-${offset + length - 1}/${size}`, status: 206 };
  }

  const offset = Number(startText);
  if (!Number.isSafeInteger(offset) || offset < 0) return FULL_BODY;
  if (offset >= size) return unsatisfiable(size);

  // Clamp the end to the representation size (why: `bytes=0-9999` on a
  // 10-byte file must yield `bytes 0-9/10`, not an unsatisfiable `0-9999/10`).
  let length = endText === '' ? size - offset : Number(endText) - offset + 1;
  if (!Number.isSafeInteger(length)) return FULL_BODY;
  if (endText !== '' && Number(endText) < offset) return unsatisfiable(size);
  if (length <= 0) return unsatisfiable(size);
  length = Math.min(length, size - offset);
  return { offset, length, contentRange: `bytes ${offset}-${offset + length - 1}/${size}`, status: 206 };
}

export { parseRangeHeader };
export type { ParsedRange };
