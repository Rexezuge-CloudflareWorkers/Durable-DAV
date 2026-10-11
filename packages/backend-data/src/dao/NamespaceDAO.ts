import { BaseDAO } from '@rexezuge/d1';
import type { D1Queryable } from '@rexezuge/d1';

export type NamespaceKind = 'user';

export interface NamespaceRow {
  username_ci: string;
  kind: NamespaceKind;
  /**
   * The claiming account's frozen anchor address. Kept as a denormalized copy;
   * ownership checks read `user_id` (migration 0004).
   */
  user_email: string | null;
  /**
  Stable account key. Absent on a pre-0004 database.
  */
  user_id?: string | null;
  created_at: number;
}

class NamespaceDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async get(usernameCi: string): Promise<NamespaceRow | undefined> {
    return this.first<NamespaceRow>('SELECT * FROM namespaces WHERE username_ci = ? LIMIT 1', [usernameCi]);
  }

  public async isTaken(usernameCi: string): Promise<boolean> {
    const row = await this.get(usernameCi);
    // The kit's first() answers absence with undefined, not null.
    return row !== undefined;
  }

  public async claim(input: { usernameCi: string; kind: NamespaceKind; userEmail?: string | null; userId?: string | null; now: number }): Promise<void> {
    await this.run('INSERT INTO namespaces (username_ci, kind, user_email, user_id, created_at) VALUES (?, ?, ?, ?, ?)', [input.usernameCi, input.kind, input.userEmail ?? null, input.userId ?? null, input.now]);
  }

  public async claimIgnore(input: { usernameCi: string; kind: NamespaceKind; userEmail?: string | null; userId?: string | null; now: number }): Promise<void> {
    await this.run('INSERT OR IGNORE INTO namespaces (username_ci, kind, user_email, user_id, created_at) VALUES (?, ?, ?, ?, ?)', [input.usernameCi, input.kind, input.userEmail ?? null, input.userId ?? null, input.now]);
  }

  public async release(usernameCi: string): Promise<void> {
    await this.run('DELETE FROM namespaces WHERE username_ci = ?', [usernameCi]);
  }
}

export { NamespaceDAO };
