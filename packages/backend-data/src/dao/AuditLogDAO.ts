import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface AuditLogRow {
  log_id: string;
  timestamp: number;
  user_email: string;
  action: string;
  resource: string | null;
  method: string;
  path: string;
  status_code: number;
  detail: string | null;
  ip_address: string | null;
  user_agent: string | null;
  org_id: string | null;
  repo_id: string | null;
  created_at: number;
}

export interface AuditLogFilters {
  orgId?: string;
  repoId?: string;
  userEmail?: string;
  action?: string;
  resourcePrefix?: string;
  startTime?: number;
  endTime?: number;
}

function escapeLike(term: string): string {
  return term.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
}

class AuditLogDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(input: {
    logId: string;
    timestamp: number;
    userEmail: string;
    action: string;
    resource?: string | null;
    method: string;
    path: string;
    statusCode: number;
    detail?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    orgId?: string | null;
    repoId?: string | null;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            'INSERT INTO audit_logs (log_id, timestamp, user_email, action, resource, method, path, status_code, detail, ip_address, user_agent, org_id, repo_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.logId,
            input.timestamp,
            input.userEmail,
            input.action,
            input.resource ?? null,
            input.method,
            input.path,
            input.statusCode,
            input.detail ?? null,
            input.ipAddress ?? null,
            input.userAgent ?? null,
            input.orgId ?? null,
            input.repoId ?? null,
            input.timestamp,
          )
          .run(),
      'append audit log',
    );
  }

  public async query(filters: AuditLogFilters, limit = 50, cursor?: string): Promise<{ logs: AuditLogRow[]; nextCursor: string | null }> {
    const decoded = this.decodeCursorOrThrow<{ timestamp: number; log_id: string }>(cursor);
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (filters.orgId) {
      conditions.push('org_id = ?');
      values.push(filters.orgId);
    }
    if (filters.repoId) {
      conditions.push('repo_id = ?');
      values.push(filters.repoId);
    }
    if (filters.userEmail) {
      conditions.push('lower(user_email) = lower(?)');
      values.push(filters.userEmail);
    }
    if (filters.action) {
      conditions.push('action = ?');
      values.push(filters.action);
    }
    if (filters.resourcePrefix) {
      conditions.push("resource LIKE ? ESCAPE '!'");
      values.push(`${escapeLike(filters.resourcePrefix)}%`);
    }
    if (filters.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      values.push(filters.startTime);
    }
    if (filters.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      values.push(filters.endTime);
    }
    if (decoded !== undefined) {
      conditions.push('(timestamp < ? OR (timestamp = ? AND log_id < ?))');
      values.push(decoded.timestamp, decoded.timestamp, decoded.log_id);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageSize = Math.min(Math.max(limit, 1), 200) + 1;
    const result = await this.database
      .prepare(`SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC, log_id DESC LIMIT ?`)
      .bind(...values, pageSize)
      .all<AuditLogRow>();
    const rows = result.results ?? [];
    const hasMore = rows.length >= pageSize;
    const page = hasMore ? rows.slice(0, pageSize - 1) : rows;
    const last = page.at(-1);
    return { logs: page, nextCursor: hasMore && last ? this.encodeCursor({ timestamp: last.timestamp, log_id: last.log_id }) : null };
  }

  /**
   * Org audit read: matches explicit `org_id` rows plus path-derived
   * `resource` snapshots (`org/:username…` for org/team management,
   * `:username/…` for pushes to org repos). Renames orphan old snapshots
   * (accepted v1 limitation, same as AccessBridge resource strings).
   */
  public async queryOrgAudit(
    orgId: string,
    orgUsername: string,
    filters: Omit<AuditLogFilters, 'orgId' | 'resourcePrefix'>,
    limit = 50,
    cursor?: string,
  ): Promise<{ logs: AuditLogRow[]; nextCursor: string | null }> {
    const decoded = this.decodeCursorOrThrow<{ timestamp: number; log_id: string }>(cursor);
    const conditions: string[] = ["(org_id = ? OR resource LIKE ? ESCAPE '!' OR resource LIKE ? ESCAPE '!')"];
    const values: Array<string | number> = [orgId, `org/${escapeLike(orgUsername)}%`, `${escapeLike(orgUsername)}/%`];
    if (filters.repoId) {
      conditions.push('repo_id = ?');
      values.push(filters.repoId);
    }
    if (filters.userEmail) {
      conditions.push('lower(user_email) = lower(?)');
      values.push(filters.userEmail);
    }
    if (filters.action) {
      conditions.push('action = ?');
      values.push(filters.action);
    }
    if (filters.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      values.push(filters.startTime);
    }
    if (filters.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      values.push(filters.endTime);
    }
    if (decoded !== undefined) {
      conditions.push('(timestamp < ? OR (timestamp = ? AND log_id < ?))');
      values.push(decoded.timestamp, decoded.timestamp, decoded.log_id);
    }
    const pageSize = Math.min(Math.max(limit, 1), 200) + 1;
    const result = await this.database
      .prepare(`SELECT * FROM audit_logs WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC, log_id DESC LIMIT ?`)
      .bind(...values, pageSize)
      .all<AuditLogRow>();
    const rows = result.results ?? [];
    const hasMore = rows.length >= pageSize;
    const page = hasMore ? rows.slice(0, pageSize - 1) : rows;
    const last = page.at(-1);
    return { logs: page, nextCursor: hasMore && last ? this.encodeCursor({ timestamp: last.timestamp, log_id: last.log_id }) : null };
  }

  public async deleteByOrg(orgId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM audit_logs WHERE org_id = ?').bind(orgId).run(),
      'delete audit logs by org',
    );
  }

  public async deleteByRepo(repoId: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM audit_logs WHERE repo_id = ?').bind(repoId).run(),
      'delete audit logs by repo',
    );
  }

  public async pruneOlderThan(cutoff: number, limit: number): Promise<number> {
    return this.deleteRowsOlderThan('audit_logs', 'timestamp', cutoff, limit, 'log_id');
  }
}

export { AuditLogDAO };
