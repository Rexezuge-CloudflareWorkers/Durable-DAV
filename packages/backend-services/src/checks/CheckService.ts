import { CheckRunDAO } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { CheckCombinedState, CheckConclusion, CheckRunMetadata, CheckRunStatus } from '@duradav/shared';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { isBuiltInCheckContext } from './CheckSteps';
import { validateWebhookUrl } from '../webhook/WebhookEvents';

export type { BuiltInCheckContext } from './CheckSteps';
export { BUILT_IN_CHECK_CONTEXTS, isBuiltInCheckContext } from './CheckSteps';

interface CheckServiceEnv {
  DB: D1Queryable;
  MAX_CHECKS_PER_SHA?: string;
  CHECK_TIMEOUT_SECONDS?: string;
  CHECK_RETENTION_DAYS?: string;
}

interface CheckServiceDeps {
  checkRunDAO?: () => Promise<CheckRunDAO>;
}

const SHA_RE = /^[0-9a-f]{40}$/i;
const CONTEXT_RE = /^[\w./-]{1,200}$/;
const MAX_TITLE = 200;
const MAX_SUMMARY = 2000;
const MAX_URL = 2048;

// Conclusions that count as passing for the required-checks merge gate.
const PASSING_CONCLUSIONS: ReadonlySet<string> = new Set(['success', 'neutral', 'skipped']);

export function normalizeHeadSha(raw: unknown): string {
  if (typeof raw !== 'string' || !SHA_RE.test(raw.trim())) throw new BadRequestError('headSha must be a 40-char hex commit SHA');
  return raw.trim().toLowerCase();
}

export function normalizeContext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new BadRequestError('context is required');
  const context = raw.trim().slice(0, 200);
  if (!CONTEXT_RE.test(context)) throw new BadRequestError('context must be 1-200 chars of letters, digits, `.`, `-`, `_`, `/`');
  return context;
}

function normalizeOptionalText(raw: unknown, max: number, label: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new BadRequestError(`${label} must be a string`);
  const value = raw.trim().slice(0, max);
  return value || null;
}

function normalizeDetailsUrl(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const url = raw.trim();
  if (url.length > MAX_URL) throw new BadRequestError('detailsUrl must be at most 2048 characters');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestError('detailsUrl must be a valid absolute URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new BadRequestError('detailsUrl must use http or https');
  // Display-only today (never fetched server-side), but apply the same
  // literal-IP SSRF guard as webhooks so a future fetch cannot turn this
  // into metadata/loopback access. DNS-rebind remains documented best-effort.
  try {
    validateWebhookUrl(url);
  } catch (error) {
    if (error instanceof BadRequestError) throw error;
    throw new BadRequestError('detailsUrl must not target a private or reserved address');
  }
  return url;
}

const CONCLUSIONS: CheckConclusion[] = ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required'];

function normalizeConclusion(raw: unknown): CheckConclusion {
  if (typeof raw !== 'string' || !(CONCLUSIONS as string[]).includes(raw)) {
    throw new BadRequestError(`conclusion must be one of ${CONCLUSIONS.join(', ')}`);
  }
  return raw as CheckConclusion;
}

class CheckService {
  private readonly deps: Required<CheckServiceDeps>;

  constructor(
    private readonly env: CheckServiceEnv,
    deps: CheckServiceDeps = {},
  ) {
    this.deps = {
      checkRunDAO: () => Promise.resolve(new CheckRunDAO(env.DB)),
      ...deps,
    };
  }

  public static isPassingConclusion(conclusion: string | null): boolean {
    if (!conclusion) return false;
    return PASSING_CONCLUSIONS.has(conclusion);
  }

  // Pure merge-gate evaluator: every required context must have a completed
  // run with a passing conclusion on this SHA. Missing, queued, in_progress,
  // or failing runs block. Empty required list never blocks.
  public static checkRequiredContexts(input: {
    requiredContexts: readonly string[];
    runs: ReadonlyArray<{ context: string; status: string; conclusion: string | null }>;
  }): { blocked: boolean; state: CheckCombinedState; pending: string[]; failing: string[] } {
    if (input.requiredContexts.length === 0) return { blocked: false, state: 'success', pending: [], failing: [] };
    const byContext = new Map<string, { status: string; conclusion: string | null }>();
    for (const run of input.runs) {
      const key = run.context.toLowerCase();
      if (!byContext.has(key)) byContext.set(key, { status: run.status, conclusion: run.conclusion });
    }
    const pending: string[] = [];
    const failing: string[] = [];
    for (const required of input.requiredContexts) {
      const run = byContext.get(required.toLowerCase());
      if (!run || run.status !== 'completed' || !run.conclusion) {
        pending.push(required);
        continue;
      }
      if (!this.isPassingConclusion(run.conclusion)) failing.push(required);
    }
    if (failing.length > 0) return { blocked: true, state: 'failure', pending, failing };
    if (pending.length > 0) return { blocked: true, state: 'pending', pending, failing };
    return { blocked: false, state: 'success', pending, failing };
  }

  public static combinedState(runs: ReadonlyArray<{ status: string; conclusion: string | null }>): CheckCombinedState {
    if (runs.length === 0) return 'pending';
    let hasPending = false;
    for (const run of runs) {
      if (run.status !== 'completed' || !run.conclusion) {
        hasPending = true;
        continue;
      }
      if (!this.isPassingConclusion(run.conclusion)) return 'failure';
    }
    return hasPending ? 'pending' : 'success';
  }

  public async reportStatus(input: {
    repositoryId: string;
    headSha: unknown;
    context: unknown;
    creatorEmail: string;
    detailsUrl?: unknown;
    outputTitle?: unknown;
    outputSummary?: unknown;
  }): Promise<CheckRunMetadata> {
    const headSha = normalizeHeadSha(input.headSha);
    const context = normalizeContext(input.context);
    const dao = await this.deps.checkRunDAO();
    const existing = await dao.getByRepoShaContext(input.repositoryId, headSha, context).catch(() => null);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    if (existing) {
      // Re-report on the same (sha, context) refreshes the queued run instead
      // of 409ing: pushes routinely re-trigger the same contexts.
      if (existing.status !== 'completed') {
        await dao.updateStatus(existing.id, input.repositoryId, {
          status: 'queued',
          conclusion: null,
          detailsUrl: normalizeDetailsUrl(input.detailsUrl) ?? existing.detailsUrl,
          outputTitle: normalizeOptionalText(input.outputTitle, MAX_TITLE, 'outputTitle') ?? existing.outputTitle,
          outputSummary: normalizeOptionalText(input.outputSummary, MAX_SUMMARY, 'outputSummary') ?? existing.outputSummary,
          now,
          completedAt: null,
        });
        const refreshed = await dao.getById(existing.id, input.repositoryId);
        if (!refreshed) throw new NotFoundError('check run not found');
        return refreshed;
      }
      throw new BadRequestError('check run already completed for this commit and context');
    }
    const count = await dao.countBySha(input.repositoryId, headSha).catch(() => 0);
    const max = ConfigurationManager.checks.getMaxPerSha(this.env);
    if (count >= max) throw new BadRequestError(`Maximum ${max} check runs per commit`);
    const id = UUIDUtil.getRandomUUID();
    await dao.create({
      id,
      repositoryId: input.repositoryId,
      headSha,
      context,
      creatorEmail: input.creatorEmail,
      now,
    });
    // Attach optional display fields when provided at report time.
    const detailsUrl = normalizeDetailsUrl(input.detailsUrl);
    const outputTitle = normalizeOptionalText(input.outputTitle, MAX_TITLE, 'outputTitle');
    const outputSummary = normalizeOptionalText(input.outputSummary, MAX_SUMMARY, 'outputSummary');
    if (detailsUrl ?? outputTitle ?? outputSummary) {
      await dao
        .updateStatus(id, input.repositoryId, {
          status: 'queued',
          conclusion: null,
          detailsUrl,
          outputTitle,
          outputSummary,
          now,
          completedAt: null,
        })
        .catch(() => undefined);
    }
    const created = await dao.getById(id, input.repositoryId);
    if (!created) throw new NotFoundError('check run not found');
    return created;
  }

  public async updateRun(input: {
    repositoryId: string;
    id: string;
    status: CheckRunStatus;
    conclusion?: unknown;
    detailsUrl?: unknown;
    outputTitle?: unknown;
    outputSummary?: unknown;
  }): Promise<CheckRunMetadata> {
    const dao = await this.deps.checkRunDAO();
    const existing = await dao.getById(input.id, input.repositoryId);
    if (!existing) throw new NotFoundError('check run not found');
    if (input.status !== 'queued' && input.status !== 'in_progress' && input.status !== 'completed') {
      throw new BadRequestError('status must be queued, in_progress, or completed');
    }
    let conclusion: CheckConclusion | null = existing.conclusion;
    if (input.status === 'completed') {
      if (input.conclusion === undefined) throw new BadRequestError('conclusion is required when status is completed');
      conclusion = normalizeConclusion(input.conclusion);
    } else if (input.conclusion !== undefined && input.conclusion !== null) {
      throw new BadRequestError('conclusion is only allowed when status is completed');
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.updateStatus(input.id, input.repositoryId, {
      status: input.status,
      conclusion,
      detailsUrl: input.detailsUrl === undefined ? existing.detailsUrl : normalizeDetailsUrl(input.detailsUrl),
      outputTitle:
        input.outputTitle === undefined ? existing.outputTitle : normalizeOptionalText(input.outputTitle, MAX_TITLE, 'outputTitle'),
      outputSummary:
        input.outputSummary === undefined
          ? existing.outputSummary
          : normalizeOptionalText(input.outputSummary, MAX_SUMMARY, 'outputSummary'),
      now,
      completedAt: input.status === 'completed' ? now : null,
    });
    const updated = await dao.getById(input.id, input.repositoryId);
    if (!updated) throw new NotFoundError('check run not found');
    return updated;
  }

  public async listForSha(repositoryId: string, headSha: string): Promise<{ runs: CheckRunMetadata[]; state: CheckCombinedState }> {
    const sha = normalizeHeadSha(headSha);
    const dao = await this.deps.checkRunDAO();
    const runs = await dao.listBySha(repositoryId, sha).catch(() => []);
    return { runs, state: CheckService.combinedState(runs) };
  }

  public async markStale(timeoutSeconds?: number, limit = 100): Promise<number> {
    const timeout = timeoutSeconds ?? ConfigurationManager.checks.getTimeoutSeconds(this.env);
    const cutoff = TimestampUtil.getCurrentUnixTimestampInSeconds() - timeout;
    const dao = await this.deps.checkRunDAO();
    const stale = await dao.listStale(['queued', 'in_progress'], cutoff, limit).catch(() => []);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    for (const row of stale) {
      await dao
        .updateStatus(row.id, row.repository_id, {
          status: 'completed',
          conclusion: 'timed_out',
          detailsUrl: row.details_url,
          outputTitle: row.output_title ?? 'Check Timed Out',
          outputSummary: row.output_summary ?? `No completion within ${timeout}s.`,
          now,
          completedAt: now,
        })
        .catch(() => undefined);
    }
    return stale.length;
  }

  public async pruneOlderThan(cutoff: number, limit: number): Promise<number> {
    const dao = await this.deps.checkRunDAO();
    return dao.pruneOlderThan(cutoff, limit).catch(() => 0);
  }

  public static isBuiltIn(input: string): boolean {
    return isBuiltInCheckContext(input);
  }
}

export { CheckService, PASSING_CONCLUSIONS };
export type { CheckServiceDeps, CheckServiceEnv };
