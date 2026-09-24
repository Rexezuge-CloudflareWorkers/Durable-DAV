import type { CheckConclusion } from '@duradav/shared';

// Built-in v1 check contexts. The CheckRunnerWorker DO executes exactly these;
// any other context string is external-only (reported via the API by CI
// runners outside Cloudflare) and never auto-executed.
export const BUILT_IN_CHECK_CONTEXTS = ['secret-scan', 'diff-limit', 'codeowners-exists', 'required-files'] as const;

export type BuiltInCheckContext = (typeof BUILT_IN_CHECK_CONTEXTS)[number];

export function isBuiltInCheckContext(context: string): context is BuiltInCheckContext {
  return (BUILT_IN_CHECK_CONTEXTS as readonly string[]).includes(context);
}

export interface StepOutcome {
  conclusion: CheckConclusion;
  title: string;
  summary: string;
}

function outcome(conclusion: CheckConclusion, title: string, summary: string): StepOutcome {
  return { conclusion, title: title.slice(0, 200), summary: summary.slice(0, 2000) };
}

// secret-scan: findings come from SecretScanService.scanText over file bytes
// (linear-time patterns only). Any finding fails the check.
export function runSecretScanStep(findings: Array<{ ruleId: string; hint: string }>): StepOutcome {
  if (findings.length === 0) return outcome('success', 'No Secrets Detected', 'Scanned file contents; no known secret patterns matched.');
  const names = findings.map((f) => f.ruleId).join(', ');
  return outcome('failure', `${findings.length} Possible Secret(s) Detected`, `Matched rules: ${names}. Remove secrets before merging.`);
}

// diff-limit: guards giant PRs that break the merge preview caps.
export function runDiffLimitStep(changedFiles: number, maxFiles: number): StepOutcome {
  if (changedFiles <= maxFiles) return outcome('success', 'Diff Within Limits', `${changedFiles} changed file(s), limit ${maxFiles}.`);
  return outcome('failure', 'Diff Exceeds Limits', `${changedFiles} changed file(s) exceeds the limit of ${maxFiles}. Split the change.`);
}

// codeowners-exists: warns when a repo has no CODEOWNERS but protection
// expects owner review. Missing file is neutral (does not block) unless the
// caller treats it as required; present-but-unparseable is action_required.
export function runCodeownersStep(args: { content: string | null; ruleCount: number }): StepOutcome {
  if (args.content === null) return outcome('neutral', 'No CODEOWNERS File', 'No CODEOWNERS file found; owner quorum cannot apply.');
  if (args.ruleCount === 0) return outcome('action_required', 'CODEOWNERS Has No Rules', 'CODEOWNERS exists but defines no usable rules.');
  return outcome('success', 'CODEOWNERS Present', `${args.ruleCount} owner rule(s) parsed.`);
}

function globToRegExp(glob: string): RegExp | null {
  const trimmed = glob.trim().replace(/^\//, '');
  if (!trimmed || trimmed.includes('..')) return null;
  try {
    const escaped = trimmed.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);
    return new RegExp(`^${escaped.replaceAll('*', '.*')}$`);
  } catch {
    return null;
  }
}

// required-files: every required glob must match at least one tree path.
// Used for contexts like `required-files:README,LICENSE`.
export function runRequiredFilesStep(treePaths: string[], requiredGlobs: string[]): StepOutcome {
  const missing: string[] = [];
  for (const glob of requiredGlobs) {
    const re = globToRegExp(glob);
    if (!re) {
      missing.push(glob);
      continue;
    }
    const hit = treePaths.some((p) => re.test(p) || re.test(p.split('/').pop() ?? ''));
    if (!hit) missing.push(glob);
  }
  if (missing.length === 0) return outcome('success', 'Required Files Present', `All ${requiredGlobs.length} required pattern(s) matched.`);
  return outcome('failure', `${missing.length} Required File(s) Missing`, `Missing: ${missing.join(', ')}.`);
}

export function parseRequiredGlobs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 200)
    .slice(0, 20);
}
