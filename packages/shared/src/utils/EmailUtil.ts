/**
 * Email shape validation for the auth boundary.
 *
 * Deliberately a shape check, not a deliverability check: the only thing this
 * guards is a malformed identity string reaching D1. The authoritative
 * validation is Cloudflare Access, which has already vouched for the address
 * by the time these strategies run — a bypass env var is the case that matters,
 * and it must fail closed rather than authenticate nonsense.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function isValidEmailFormat(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 254 && EMAIL_RE.test(trimmed);
}

export { isValidEmailFormat };
