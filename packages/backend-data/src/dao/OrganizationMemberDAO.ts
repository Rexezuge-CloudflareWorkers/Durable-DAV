import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export type OrgMemberRole = 'owner' | 'member';

export interface OrganizationMemberRow {
  org_id: string;
  user_email: string;
  role: OrgMemberRole;
  created_at: number;
}

class OrganizationMemberDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async upsert(orgId: string, userEmail: string, role: OrgMemberRole, now: number): Promise<void> {
    const normalized = userEmail.toLowerCase();
    await this.withRetry(async () => {
      // Collapse legacy mixed-case duplicates so `lower(user_email)` reads stay unique.
      await this.database
        .prepare('DELETE FROM organization_members WHERE org_id = ? AND lower(user_email) = ? AND user_email != ?')
        .bind(orgId, normalized, normalized)
        .run()
        .catch(() => undefined);
      return this.database
        .prepare(
          'INSERT INTO organization_members (org_id, user_email, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(org_id, user_email) DO UPDATE SET role = excluded.role',
        )
        .bind(orgId, normalized, role, now)
        .run();
    }, 'upsert organization member');
  }

  public async get(orgId: string, userEmail: string): Promise<OrganizationMemberRow | null> {
    return this.database
      .prepare('SELECT * FROM organization_members WHERE org_id = ? AND lower(user_email) = lower(?) LIMIT 1')
      .bind(orgId, userEmail)
      .first<OrganizationMemberRow>();
  }

  public async listByOrg(orgId: string, limit = 200): Promise<OrganizationMemberRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM organization_members WHERE org_id = ? ORDER BY created_at ASC LIMIT ?')
      .bind(orgId, limit)
      .all<OrganizationMemberRow>();
    return result.results ?? [];
  }

  public async listOrgsByUser(userEmail: string, limit = 200): Promise<OrganizationMemberRow[]> {
    const result = await this.database
      .prepare('SELECT * FROM organization_members WHERE lower(user_email) = lower(?) ORDER BY created_at ASC LIMIT ?')
      .bind(userEmail, limit)
      .all<OrganizationMemberRow>();
    return result.results ?? [];
  }

  public async remove(orgId: string, userEmail: string): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('DELETE FROM organization_members WHERE org_id = ? AND lower(user_email) = lower(?)')
          .bind(orgId, userEmail)
          .run(),
      'remove organization member',
    );
  }

  public async deleteByOrg(orgId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM organization_members WHERE org_id = ?').bind(orgId).run(),
      'delete members by org',
    );
  }

  public async countOwners(orgId: string): Promise<number> {
    const row = await this.database
      .prepare("SELECT COUNT(*) AS n FROM organization_members WHERE org_id = ? AND role = 'owner'")
      .bind(orgId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
}

export { OrganizationMemberDAO };
