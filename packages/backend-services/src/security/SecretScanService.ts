import type { SecretFinding } from '@duradav/shared';

interface SecretRule {
  id: string;
  hint: string;
  pattern: RegExp;
}

// Linear-time patterns only (no nested quantifiers): safe to run over
// multi-megabyte pack bodies in the request path.
const SECRET_RULES: readonly SecretRule[] = [
  { id: 'aws-access-key', hint: 'Possible AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { id: 'github-token', hint: 'Possible GitHub token', pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|github_pat_\w{22,}/ },
  { id: 'gitlab-token', hint: 'Possible GitLab token', pattern: /glpat-[\w-]{20,}/ },
  { id: 'slack-token', hint: 'Possible Slack token', pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'stripe-key', hint: 'Possible Stripe secret key', pattern: /sk_live_[A-Za-z0-9]{16,}/ },
  { id: 'private-key', hint: 'Possible private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'generic-api-key', hint: 'Possible hardcoded API key', pattern: /api[_-]?key["']?\s*[:=]\s*["']?[\w\-]{20,}/i },
];

const MAX_FINDINGS = 10;

function scanText(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  for (const rule of SECRET_RULES) {
    // Fresh lastIndex per rule (global flag is never set, but be explicit).
    const matched = rule.pattern.test(text);
    if (!matched) continue;
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    findings.push({ ruleId: rule.id, hint: rule.hint });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings;
}

function scanBytes(body: Uint8Array): SecretFinding[] {
  if (body.byteLength === 0) return [];
  // latin1 gives a 1:1 byte→char mapping so ASCII secrets in binary packs
  // still match without copying through base64.
  const text = new TextDecoder('latin1').decode(body);
  return scanText(text);
}

export { SECRET_RULES, MAX_FINDINGS, scanText, scanBytes };
