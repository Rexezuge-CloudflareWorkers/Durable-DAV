import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';
import type { BranchProtectionRuleMetadata } from '@duradav/shared';

export interface BranchProtectionRuleRow {
  id: string;
  repository_id: string;
  pattern: string;
  require_pr: number;
  required_approvals: number;
  block_force_push: number;
  block_deletion: number;
  created_by: string;
  created_at: number;
}

function toMetadata(row: BranchProtectionRuleRow, requireStatusChecks: string[]): BranchProtectionRuleMetadata {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    pattern: row.pattern,
    requirePr: row.require_pr === 1,
    requiredApprovals: row.required_approvals,
    blockForcePush: row.block_force_push === 1,
    blockDeletion: row.block_deletion === 1,
    // Checks live only in the junction table (0024 dropped the JSON column).
    requireStatusChecks,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

class BranchProtectionDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(input: {
    id: string;
    repositoryId: string;
    pattern: string;
    requirePr: boolean;
    requiredApprovals: number;
    blockForcePush: boolean;
    blockDeletion: boolean;
    requireStatusChecks: readonly string[];
    createdBy: string;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO branch_protection_rules (id, repository_id, pattern, require_pr, required_approvals, block_force_push, block_deletion, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.id,
            input.repositoryId,
            input.pattern,
            input.requirePr ? 1 : 0,
            input.requiredApprovals,
            input.blockForcePush ? 1 : 0,
            input.blockDeletion ? 1 : 0,
            input.createdBy.toLowerCase(),
            input.now,
          )
          .run(),
      'create branch protection rule',
    );
    // Checks live only in the junction table: fail closed by rolling back
    // the rule when the junction write fails.
    try {
      await this.replaceContexts(input.id, input.requireStatusChecks, input.now);
    } catch (error) {
      await this.database.prepare('DELETE FROM branch_protection_rules WHERE id = ?').bind(input.id).run().catch(() => undefined);
      throw error;
    }
  }

  public async listContexts(ruleId: string): Promise<string[]> {
    const result = await this.database
      .prepare('SELECT context FROM branch_protection_required_checks WHERE rule_id = ?')
      .bind(ruleId)
      .all<{ context: string }>();
    return (result.results ?? []).map((row) => row.context);
  }

  public async replaceContexts(ruleId: string, contexts: readonly string[], now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM branch_protection_required_checks WHERE rule_id = ?').bind(ruleId).run(),
      'replace branch protection checks',
    );
    for (const context of contexts) {
      await this.withRetry(
        () =>
          this.database
            .prepare('INSERT OR IGNORE INTO branch_protection_required_checks (rule_id, context, created_at) VALUES (?, ?, ?)')
            .bind(ruleId, context, now)
            .run(),
        'insert branch protection check',
      );
    }
  }

  private async withJunctionContexts(row: BranchProtectionRuleRow): Promise<BranchProtectionRuleMetadata> {
    const contexts = await this.listContexts(row.id).catch(() => [] as string[]);
    return toMetadata(row, contexts);
  }

  public async listByRepo(repositoryId: string): Promise<BranchProtectionRuleMetadata[]> {
    const result = await this.database
      .prepare('SELECT * FROM branch_protection_rules WHERE repository_id = ? ORDER BY pattern ASC')
      .bind(repositoryId)
      .all<BranchProtectionRuleRow>();
    const rows = result.results ?? [];
    const out: BranchProtectionRuleMetadata[] = [];
    for (const row of rows) out.push(await this.withJunctionContexts(row));
    return out;
  }

  public async getById(id: string): Promise<BranchProtectionRuleMetadata | null> {
    const row = await this.findRowById<BranchProtectionRuleRow>('branch_protection_rules', 'id', id);
    if (!row) return null;
    return this.withJunctionContexts(row);
  }

  public async getByRepoAndPattern(repositoryId: string, pattern: string): Promise<BranchProtectionRuleMetadata | null> {
    const row = await this.database
      .prepare('SELECT * FROM branch_protection_rules WHERE repository_id = ? AND pattern = ? LIMIT 1')
      .bind(repositoryId, pattern)
      .first<BranchProtectionRuleRow>();
    if (!row) return null;
    return this.withJunctionContexts(row);
  }

  public async countByRepo(repositoryId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS n FROM branch_protection_rules WHERE repository_id = ?')
      .bind(repositoryId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  public async delete(id: string, repositoryId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM branch_protection_rules WHERE id = ? AND repository_id = ?').bind(id, repositoryId).run(),
      'delete branch protection rule',
    );
    await this.withRetry(
      () => this.database.prepare('DELETE FROM branch_protection_required_checks WHERE rule_id = ?').bind(id).run(),
      'delete branch protection checks',
    ).catch(() => undefined);
  }

  public async deleteByRepo(repositoryId: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'DELETE FROM branch_protection_required_checks WHERE rule_id IN (SELECT id FROM branch_protection_rules WHERE repository_id = ?)',
          )
          .bind(repositoryId)
          .run(),
      'delete branch protection checks by repo',
    ).catch(() => undefined);
    await this.withRetry(
      () => this.database.prepare('DELETE FROM branch_protection_rules WHERE repository_id = ?').bind(repositoryId).run(),
      'delete branch protection rules by repo',
    );
  }
}

export { BranchProtectionDAO };
