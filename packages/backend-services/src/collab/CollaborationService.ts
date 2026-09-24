import { CollaborationDAO } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { TimestampUtil, UUIDUtil, mapWithConcurrency } from '@duradav/shared/utils';

interface CollaborationServiceEnv {
  DB: D1Queryable;
}

interface CollaborationServiceDeps {
  collaborationDAO?: () => Promise<CollaborationDAO>;
}

const LABEL_NAME_RE = /^[\w .\-/:]{1,50}$/;
const COLOR_RE = /^[0-9a-f]{6}$/i;
const MAX_LABELS_PER_REPO = 100;
const MAX_ASSIGNEES = 10;
const MAX_REVIEWERS = 10;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  if (email.includes(' ') || email.includes('\t') || email.includes('\n')) return false;
  const at = email.indexOf('@');
  if (at <= 0) {
    // Usernames (for tests / local handles) without a domain.
    return /^[\w.-]{1,100}$/.test(email);
  }
  if (email.includes('@', at + 1)) return false;
  return email.indexOf('.', at) > at + 1 && at !== email.length - 1;
}

class CollaborationService {
  private readonly deps: Required<CollaborationServiceDeps>;

  constructor(
    private readonly env: CollaborationServiceEnv,
    deps: CollaborationServiceDeps = {},
  ) {
    this.deps = {
      collaborationDAO: () => Promise.resolve(new CollaborationDAO(env.DB)),
      ...deps,
    };
  }

  public async createLabel(
    repositoryId: string,
    input: { name: string; color?: string; description?: string | null },
  ): Promise<{ id: string; name: string }> {
    const name = input.name.trim();
    if (!LABEL_NAME_RE.test(name)) throw new BadRequestError('label name must be 1-50 chars of letters, digits, space, .-/:_');
    const color = (input.color ?? 'ededed').replace(/^#/, '').toLowerCase();
    if (!COLOR_RE.test(color)) throw new BadRequestError('color must be a 6-digit hex string');
    const description = input.description?.trim() ? input.description.trim().slice(0, 200) : null;
    const dao = await this.deps.collaborationDAO();
    const existing = await dao.listLabels(repositoryId);
    if (existing.length >= MAX_LABELS_PER_REPO) throw new BadRequestError(`Maximum ${MAX_LABELS_PER_REPO} labels per repository`);
    if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase()))
      throw new BadRequestError('a label with this name already exists');
    const id = UUIDUtil.getRandomUUID();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.createLabel({ id, repositoryId, name, color, description, now });
    return { id, name };
  }

  public async listLabels(repositoryId: string) {
    const dao = await this.deps.collaborationDAO();
    return dao.listLabels(repositoryId);
  }

  public async deleteLabel(repositoryId: string, labelId: string): Promise<void> {
    const dao = await this.deps.collaborationDAO();
    const row = await dao.getLabelById(labelId, repositoryId);
    if (!row) throw new NotFoundError('Label not found');
    await dao.deleteLabel(labelId, repositoryId);
  }

  public async createMilestone(
    repositoryId: string,
    input: { title: string; description?: string | null; dueOn?: number | null },
  ): Promise<{ id: string }> {
    const title = input.title.trim();
    if (!title || title.length > 100) throw new BadRequestError('title must be 1-100 characters');
    const description = input.description?.trim() ? input.description.trim().slice(0, 1000) : null;
    const id = UUIDUtil.getRandomUUID();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const dao = await this.deps.collaborationDAO();
    await dao.createMilestone({ id, repositoryId, title, description, dueOn: input.dueOn ?? null, now });
    return { id };
  }

  public async listMilestones(repositoryId: string) {
    const dao = await this.deps.collaborationDAO();
    return dao.listMilestones(repositoryId);
  }

  public async updateMilestone(repositoryId: string, milestoneId: string, input: { status?: string }): Promise<void> {
    const dao = await this.deps.collaborationDAO();
    const row = await dao.getMilestone(milestoneId, repositoryId);
    if (!row) throw new NotFoundError('Milestone not found');
    if (input.status !== undefined) {
      if (input.status !== 'open' && input.status !== 'closed') throw new BadRequestError('status must be open or closed');
      await dao.setMilestoneStatus(milestoneId, repositoryId, input.status);
    }
  }

  public async deleteMilestone(repositoryId: string, milestoneId: string): Promise<void> {
    const dao = await this.deps.collaborationDAO();
    const row = await dao.getMilestone(milestoneId, repositoryId);
    if (!row) throw new NotFoundError('Milestone not found');
    await dao.deleteMilestone(milestoneId, repositoryId);
  }

  private parseEmails(emails: unknown): string[] {
    if (!Array.isArray(emails)) throw new BadRequestError('assignees must be an array of strings');
    if (emails.length > MAX_ASSIGNEES) throw new BadRequestError(`at most ${MAX_ASSIGNEES} assignees`);
    const out: string[] = [];
    for (const e of emails) {
      if (typeof e !== 'string' || !e.trim()) throw new BadRequestError('assignees must be an array of non-empty strings');
      const normalized = normalizeEmail(e);
      if (!isValidEmail(normalized)) throw new BadRequestError(`invalid assignee: ${e}`);
      if (!out.includes(normalized)) out.push(normalized);
    }
    return out;
  }

  public async setIssueLabels(issueId: string, repositoryId: string, labelIds: unknown): Promise<void> {
    if (!Array.isArray(labelIds)) throw new BadRequestError('labelIds must be an array');
    const dao = await this.deps.collaborationDAO();
    const repoLabels = await dao.listLabels(repositoryId);
    const valid = new Set(repoLabels.map((l) => l.id));
    for (const id of labelIds) {
      if (typeof id !== 'string' || !valid.has(id)) throw new BadRequestError('unknown label id');
    }
    await dao.setIssueLabels(issueId, labelIds as string[]);
  }

  public async setIssueAssignees(issueId: string, emails: unknown): Promise<void> {
    const parsed = this.parseEmails(emails);
    const dao = await this.deps.collaborationDAO();
    await dao.setIssueAssignees(issueId, parsed, TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async setIssueMilestone(issueId: string, repositoryId: string, milestoneId: string | null): Promise<void> {
    const dao = await this.deps.collaborationDAO();
    if (milestoneId !== null) {
      const row = await dao.getMilestone(milestoneId, repositoryId);
      if (!row) throw new BadRequestError('unknown milestone');
    }
    await dao.setIssueMilestone(issueId, milestoneId);
  }

  public async getIssueMeta(issueId: string) {
    const dao = await this.deps.collaborationDAO();
    const [labels, assignees] = await Promise.all([dao.listIssueLabels(issueId), dao.listIssueAssignees(issueId)]);
    return { labels, assignees };
  }

  /**
   * Batched meta for issue filter fan-out (why: IssueRoutes filtered up to 50
   * issues with sequential getIssueMeta; now one bounded concurrent batch).
   * Per-issue failures degrade to empty meta so filters stay best-effort.
   */
  public async getIssueMetas(issueIds: readonly string[]): Promise<Array<{ labels: Array<{ name: string }>; assignees: string[] }>> {
    if (issueIds.length === 0) return [];
    return mapWithConcurrency(issueIds, 10, (id) => this.getIssueMeta(id).catch(() => ({ labels: [], assignees: [] })));
  }

  public async setPullLabels(pullRequestId: string, repositoryId: string, labelIds: unknown): Promise<void> {
    if (!Array.isArray(labelIds)) throw new BadRequestError('labelIds must be an array');
    const dao = await this.deps.collaborationDAO();
    const repoLabels = await dao.listLabels(repositoryId);
    const valid = new Set(repoLabels.map((l) => l.id));
    for (const id of labelIds) {
      if (typeof id !== 'string' || !valid.has(id)) throw new BadRequestError('unknown label id');
    }
    await dao.setPullLabels(pullRequestId, labelIds as string[]);
  }

  public async setPullAssignees(pullRequestId: string, emails: unknown): Promise<void> {
    const parsed = this.parseEmails(emails);
    const dao = await this.deps.collaborationDAO();
    await dao.setPullAssignees(pullRequestId, parsed, TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async setPullMilestone(pullId: string, repositoryId: string, milestoneId: string | null): Promise<void> {
    const dao = await this.deps.collaborationDAO();
    if (milestoneId !== null) {
      const row = await dao.getMilestone(milestoneId, repositoryId);
      if (!row) throw new BadRequestError('unknown milestone');
    }
    await dao.setPullMilestone(pullId, milestoneId);
  }

  public async getPullMeta(pullRequestId: string) {
    const dao = await this.deps.collaborationDAO();
    const [labels, assignees, reviewers] = await Promise.all([
      dao.listPullLabels(pullRequestId),
      dao.listPullAssignees(pullRequestId),
      dao.listReviewers(pullRequestId),
    ]);
    return { labels, assignees, reviewers };
  }

  public async requestReviewers(pullRequestId: string, emails: unknown): Promise<void> {
    if (!Array.isArray(emails)) throw new BadRequestError('reviewers must be an array of strings');
    if (emails.length === 0) throw new BadRequestError('reviewers must not be empty');
    if (emails.length > MAX_REVIEWERS) throw new BadRequestError(`at most ${MAX_REVIEWERS} reviewers`);
    const parsed: string[] = [];
    for (const e of emails) {
      if (typeof e !== 'string' || !e.trim()) throw new BadRequestError('reviewers must be an array of non-empty strings');
      const normalized = normalizeEmail(e);
      if (!isValidEmail(normalized)) throw new BadRequestError(`invalid reviewer: ${e}`);
      if (!parsed.includes(normalized)) parsed.push(normalized);
    }
    const dao = await this.deps.collaborationDAO();
    await dao.requestReviewers(pullRequestId, parsed, TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async removeReviewer(pullRequestId: string, email: string): Promise<void> {
    const dao = await this.deps.collaborationDAO();
    await dao.removeReviewer(pullRequestId, normalizeEmail(email));
  }

  public async listReviewers(pullRequestId: string) {
    const dao = await this.deps.collaborationDAO();
    return dao.listReviewers(pullRequestId);
  }

  public async syncReviewerStatus(
    pullRequestId: string,
    email: string,
    status: 'pending' | 'approved' | 'changes_requested',
  ): Promise<void> {
    const dao = await this.deps.collaborationDAO();
    await dao.syncReviewerStatus(pullRequestId, normalizeEmail(email), status).catch(() => undefined);
  }
}

export { CollaborationService };
export type { CollaborationServiceDeps, CollaborationServiceEnv };
