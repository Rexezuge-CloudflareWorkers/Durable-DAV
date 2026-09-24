import { BaseDAO } from './BaseDAO';
import { CollaborationQueries } from './CollaborationQueries';
import type { D1Queryable } from '../utils/D1Types';

export interface LabelRow {
  id: string;
  repository_id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: number;
}

export interface MilestoneRow {
  id: string;
  repository_id: string;
  title: string;
  description: string | null;
  due_on: number | null;
  status: string;
  created_at: number;
}

export interface PullReviewerRow {
  pull_request_id: string;
  user_email: string;
  status: string;
  created_at: number;
}

class CollaborationDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  // Generic subject-label/assignee writer shared by the issue/pull mirrors
  // below (Strategy pattern): one implementation, table names injected.
  private async setSubjectLabels(subjectId: string, labelIds: string[], tables: { link: string; idColumn: string }): Promise<void> {
    await this.withRetry(
      () => this.database.prepare(`DELETE FROM ${tables.link} WHERE ${tables.idColumn} = ?`).bind(subjectId).run(),
      `clear ${tables.link}`,
    );
    for (const labelId of labelIds) {
      await this.withRetry(
        () =>
          this.database
            .prepare(`INSERT OR IGNORE INTO ${tables.link} (${tables.idColumn}, label_id) VALUES (?, ?)`)
            .bind(subjectId, labelId)
            .run(),
        `set ${tables.link}`,
      );
    }
  }

  private async setSubjectAssignees(
    subjectId: string,
    emails: string[],
    now: number,
    tables: { link: string; idColumn: string },
  ): Promise<void> {
    await this.withRetry(
      () => this.database.prepare(`DELETE FROM ${tables.link} WHERE ${tables.idColumn} = ?`).bind(subjectId).run(),
      `clear ${tables.link}`,
    );
    for (const email of emails) {
      await this.withRetry(
        () =>
          this.database
            .prepare(`INSERT OR IGNORE INTO ${tables.link} (${tables.idColumn}, user_email, created_at) VALUES (?, ?, ?)`)
            .bind(subjectId, email.toLowerCase(), now)
            .run(),
        `set ${tables.link}`,
      );
    }
  }

  private async listSubjectAssignees(subjectId: string, tables: { link: string; idColumn: string }): Promise<string[]> {
    const result = await this.database
      .prepare(`SELECT user_email AS email FROM ${tables.link} WHERE ${tables.idColumn} = ? ORDER BY user_email ASC`)
      .bind(subjectId)
      .all<{ email: string }>();
    return (result.results ?? []).map((r) => r.email);
  }

  public async createLabel(input: {
    id: string;
    repositoryId: string;
    name: string;
    color: string;
    description: string | null;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(CollaborationQueries.insertLabel())
          .bind(input.id, input.repositoryId, input.name, input.color, input.description, input.now)
          .run(),
      'create label',
    );
  }

  public async listLabels(repositoryId: string): Promise<LabelRow[]> {
    const result = await this.database.prepare(CollaborationQueries.listLabels()).bind(repositoryId).all<LabelRow>();
    return result.results ?? [];
  }

  public async getLabelByName(repositoryId: string, name: string): Promise<LabelRow | null> {
    return this.database
      .prepare('SELECT * FROM labels WHERE repository_id = ? AND name = ? LIMIT 1')
      .bind(repositoryId, name)
      .first<LabelRow>();
  }

  public async getLabelById(id: string, repositoryId: string): Promise<LabelRow | null> {
    return this.database
      .prepare('SELECT * FROM labels WHERE id = ? AND repository_id = ? LIMIT 1')
      .bind(id, repositoryId)
      .first<LabelRow>();
  }

  public async deleteLabel(id: string, repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM labels WHERE id = ? AND repository_id = ?').bind(id, repositoryId).run(),
      'delete label',
    );
  }

  public async createMilestone(input: {
    id: string;
    repositoryId: string;
    title: string;
    description: string | null;
    dueOn: number | null;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(CollaborationQueries.insertMilestoneOpen())
          .bind(input.id, input.repositoryId, input.title, input.description, input.dueOn, input.now)
          .run(),
      'create milestone',
    );
  }

  public async listMilestones(repositoryId: string): Promise<MilestoneRow[]> {
    const result = await this.database.prepare(CollaborationQueries.listMilestones()).bind(repositoryId).all<MilestoneRow>();
    return result.results ?? [];
  }

  public async getMilestone(id: string, repositoryId: string): Promise<MilestoneRow | null> {
    return this.database
      .prepare('SELECT * FROM milestones WHERE id = ? AND repository_id = ? LIMIT 1')
      .bind(id, repositoryId)
      .first<MilestoneRow>();
  }

  public async setMilestoneStatus(id: string, repositoryId: string, status: 'open' | 'closed'): Promise<void> {
    await this.withRetry(
      () =>
        this.database.prepare('UPDATE milestones SET status = ? WHERE id = ? AND repository_id = ?').bind(status, id, repositoryId).run(),
      'update milestone status',
    );
  }

  public async deleteMilestone(id: string, repositoryId: string): Promise<void> {
    await this.database
      .prepare('UPDATE issues SET milestone_id = NULL WHERE milestone_id = ?')
      .bind(id)
      .run()
      .catch(() => undefined);
    await this.database
      .prepare('UPDATE pull_requests SET milestone_id = NULL WHERE milestone_id = ?')
      .bind(id)
      .run()
      .catch(() => undefined);
    await this.withRetry(
      () => this.database.prepare('DELETE FROM milestones WHERE id = ? AND repository_id = ?').bind(id, repositoryId).run(),
      'delete milestone',
    );
  }

  public async setIssueLabels(issueId: string, labelIds: string[]): Promise<void> {
    await this.setSubjectLabels(issueId, labelIds, { link: 'issue_labels', idColumn: 'issue_id' });
  }

  public async listIssueLabels(issueId: string): Promise<LabelRow[]> {
    const result = await this.database
      .prepare('SELECT l.* FROM labels l INNER JOIN issue_labels il ON il.label_id = l.id WHERE il.issue_id = ? ORDER BY l.name ASC')
      .bind(issueId)
      .all<LabelRow>();
    return result.results ?? [];
  }

  public async setIssueAssignees(issueId: string, emails: string[], now: number): Promise<void> {
    await this.setSubjectAssignees(issueId, emails, now, { link: 'issue_assignees', idColumn: 'issue_id' });
  }

  public async listIssueAssignees(issueId: string): Promise<string[]> {
    return this.listSubjectAssignees(issueId, { link: 'issue_assignees', idColumn: 'issue_id' });
  }

  public async setIssueMilestone(issueId: string, milestoneId: string | null): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE issues SET milestone_id = ? WHERE id = ?').bind(milestoneId, issueId).run(),
      'set issue milestone',
    );
  }

  public async setPullLabels(pullRequestId: string, labelIds: string[]): Promise<void> {
    await this.setSubjectLabels(pullRequestId, labelIds, { link: 'pull_labels', idColumn: 'pull_request_id' });
  }

  public async listPullLabels(pullRequestId: string): Promise<LabelRow[]> {
    const result = await this.database
      .prepare('SELECT l.* FROM labels l INNER JOIN pull_labels pl ON pl.label_id = l.id WHERE pl.pull_request_id = ? ORDER BY l.name ASC')
      .bind(pullRequestId)
      .all<LabelRow>();
    return result.results ?? [];
  }

  public async setPullAssignees(pullRequestId: string, emails: string[], now: number): Promise<void> {
    await this.setSubjectAssignees(pullRequestId, emails, now, { link: 'pull_assignees', idColumn: 'pull_request_id' });
  }

  public async listPullAssignees(pullRequestId: string): Promise<string[]> {
    return this.listSubjectAssignees(pullRequestId, { link: 'pull_assignees', idColumn: 'pull_request_id' });
  }

  public async setPullMilestone(pullId: string, milestoneId: string | null): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE pull_requests SET milestone_id = ? WHERE id = ?').bind(milestoneId, pullId).run(),
      'set pull milestone',
    );
  }

  public async setPullDraft(pullId: string, isDraft: boolean): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE pull_requests SET is_draft = ? WHERE id = ?')
          .bind(isDraft ? 1 : 0, pullId)
          .run(),
      'set pull draft',
    );
  }

  public async requestReviewers(pullRequestId: string, emails: string[], now: number): Promise<void> {
    for (const email of emails) {
      await this.withRetry(
        () => this.database.prepare(CollaborationQueries.insertReviewerIgnore()).bind(pullRequestId, email.toLowerCase(), now).run(),
        'request reviewer',
      );
    }
  }

  public async listReviewers(pullRequestId: string): Promise<PullReviewerRow[]> {
    const result = await this.database.prepare(CollaborationQueries.listReviewersByEmail()).bind(pullRequestId).all<PullReviewerRow>();
    return result.results ?? [];
  }

  public async removeReviewer(pullRequestId: string, email: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM pull_reviewers WHERE pull_request_id = ? AND user_email = ?')
          .bind(pullRequestId, email.toLowerCase())
          .run(),
      'remove reviewer',
    );
  }

  public async syncReviewerStatus(
    pullRequestId: string,
    email: string,
    status: 'pending' | 'approved' | 'changes_requested',
  ): Promise<void> {
    await this.database
      .prepare('UPDATE pull_reviewers SET status = ? WHERE pull_request_id = ? AND user_email = ?')
      .bind(status, pullRequestId, email.toLowerCase())
      .run()
      .catch(() => undefined);
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM labels WHERE repository_id = ?')
      .bind(repositoryId)
      .run()
      .catch(() => undefined);
    await this.database
      .prepare('DELETE FROM milestones WHERE repository_id = ?')
      .bind(repositoryId)
      .run()
      .catch(() => undefined);
  }
}

export { CollaborationDAO };
