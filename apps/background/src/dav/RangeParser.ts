// Pure HTTP Range parser (why: `handleGet` mixed Range math with I/O, which
// made suffix/open-ended edge cases untestable and easy to regress).

interface ParsedRange {
  offset: number;
  length: number | undefined;
  contentRange: string | undefined;
  status: 200 | 206;
}

const RANGE_RE = /bytes=(\d*)-(\d*)/;

function parseRangeHeader(rangeHeader: string | null, size: number): ParsedRange {
  if (!rangeHeader) return { offset: 0, length: undefined, contentRange: undefined, status: 200 };
  const match = RANGE_RE.exec(rangeHeader);
  if (!match) return { offset: 0, length: undefined, contentRange: undefined, status: 200 };
  const [, startText, endText] = match;
  if (startText === '' && endText !== '') {
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return { offset: 0, length: undefined, contentRange: undefined, status: 200 };
    }
    const offset = Math.max(0, size - suffix);
    const length = size - offset;
    return { offset, length, contentRange: `bytes ${offset}-${offset + length - 1}/${size}`, status: 206 };
  }
  const offset = Number(startText || 0);
  if (!Number.isFinite(offset) || offset < 0 || offset >= size) {
    return { offset: 0, length: undefined, contentRange: undefined, status: 200 };
  }
  const length = endText === '' ? size - offset : Number(endText) - offset + 1;
  if (!Number.isFinite(length) || length <= 0) {
    return { offset: 0, length: undefined, contentRange: undefined, status: 200 };
  }
  return { offset, length, contentRange: `bytes ${offset}-${offset + length - 1}/${size}`, status: 206 };
}

export { parseRangeHeader };
export type { ParsedRange };
