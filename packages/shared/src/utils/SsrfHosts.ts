/**
 * Canonical SSRF host helpers (Layer 0).
 *
 * Why this exists: `GitUrlPolicy` (git imports, https-only) and webhook URL
 * validation previously duplicated bracket/dot stripping, encoded-numeric
 * detection, and IPv6 blocklists. A fix in one copy missed the other, so both
 * now delegate here. Policy differences (allowed schemes, IPv4 handling)
 * stay with the callers — only the shared host predicates live here.
 */

const MAX_URL_LENGTH = 2048;

function stripBrackets(host: string): string {
  const h = host.trim();
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

function stripTrailingDot(host: string): string {
  const unbracketed = stripBrackets(host);
  let end = unbracketed.length;
  while (end > 0 && unbracketed.charAt(end - 1) === '.') end -= 1;
  return unbracketed.slice(0, end);
}

function isEncodedNumericHost(host: string): boolean {
  const h = host.toLowerCase();
  if (/^0x[\da-f]+$/i.test(h) || /^\d+$/.test(h) || /^0[0-7]+(?:\.0[0-7]+)+$/.test(h) || /^0x[\da-f.]+$/i.test(h)) return true;
  if (/^[\d.]+$/.test(h) && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function isBlockedIpv6Host(host: string): boolean {
  const h = host.toLowerCase();
  return (h === '::' || h === '::1' || h.startsWith('::ffff:') || /^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(h) || h.startsWith('fc') || h.startsWith('fd') || /^fe[89ab]/i.test(h) || h.startsWith('ff') || h.startsWith('fe80:'));
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === '::1' || h === '0.0.0.0' || h === '::' || h.startsWith('::ffff:127.');
}

function isLocalhostName(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === 'localhost.localdomain' || h.endsWith('.localhost');
}

export {
  MAX_URL_LENGTH,
  stripBrackets,
  stripTrailingDot,
  isEncodedNumericHost,
  isBlockedIpv6Host,
  isLoopbackHost,
  isLocalhostName,
};
