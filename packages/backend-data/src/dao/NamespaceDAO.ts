import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export type NamespaceKind = 'user' | 'org';

export interface NamespaceRow {
  username_ci: string;
  kind: NamespaceKind;
  user_email: string | null;
  org_id: string | null;
  created_at: number;
}

class NamespaceDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async get(usernameCi: string): Promise<NamespaceRow | null> {
    return this.database.prepare('SELECT * FROM namespaces WHERE username_ci = ? LIMIT 1').bind(usernameCi).first<NamespaceRow>();
  }

  public async isTaken(usernameCi: string): Promise<boolean> {
    const row = await this.get(usernameCi);
    return row !== null;
  }

  public async claim(input: {
    usernameCi: string;
    kind: NamespaceKind;
    userEmail?: string | null;
    orgId?: string | null;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT INTO namespaces (username_ci, kind, user_email, org_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(input.usernameCi, input.kind, input.userEmail ?? null, input.orgId ?? null, input.now)
          .run(),
      'claim namespace',
    );
  }

  public async claimIgnore(input: {
    usernameCi: string;
    kind: NamespaceKind;
    userEmail?: string | null;
    orgId?: string | null;
    now: number;
  }): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('INSERT OR IGNORE INTO namespaces (username_ci, kind, user_email, org_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(input.usernameCi, input.kind, input.userEmail ?? null, input.orgId ?? null, input.now)
          .run(),
      'claim namespace ignore',
    );
  }

  public async release(usernameCi: string): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('DELETE FROM namespaces WHERE username_ci = ?').bind(usernameCi).run(),
      'release namespace',
    );
  }
}

export { NamespaceDAO };
