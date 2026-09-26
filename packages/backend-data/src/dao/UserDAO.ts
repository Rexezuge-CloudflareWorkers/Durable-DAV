import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface UserRow {
  email: string;
  created_at: number;
  username: string | null;
  updated_at: number | null;
}

class UserDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async upsertUser(email: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database.prepare('INSERT INTO users (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING').bind(email, now).run(),
      'upsert user',
    );
  }

  public async ensureUsername(email: string, username: string, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare('UPDATE users SET username = COALESCE(username, ?), updated_at = COALESCE(updated_at, ?) WHERE email = ?')
          .bind(username, now, email)
          .run(),
      'ensure username',
    );
  }

  public async setUsername(email: string, username: string, now: number): Promise<void> {
    await this.withRetry(
      () => this.database.prepare('UPDATE users SET username = ?, updated_at = ? WHERE email = ?').bind(username, now, email).run(),
      'set username',
    );
  }

  public async getByEmail(email: string): Promise<UserRow | null> {
    // Emails are lowercased by every writer (`UserService.upsertUser`), so a
    // `lower(email) = lower(?)` predicate is redundant *and* index-defeating:
    // the function call on the column means `idx_users_email` cannot be used.
    return this.database.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').bind(email.toLowerCase()).first<UserRow>();
  }

  public async getByUsernameCi(usernameCi: string): Promise<UserRow | null> {
    // Lowercase the parameter rather than the column: the column is stored
    // lowercased, so `lower(username) = ?` gave identical matching semantics
    // while making `idx_users_username` unusable.
    return this.database.prepare('SELECT * FROM users WHERE username = ? LIMIT 1').bind(usernameCi.toLowerCase()).first<UserRow>();
  }
}

export { UserDAO };
