import { applyMigrations } from './migrations';

/**
 * Shared setup for Durable-DAV integration tests (real D1 via `SELF.fetch`).
 * Auth is `DEV_AUTH_EMAIL`-based, so `/user/*` needs no credentials.
 * WebDAV (`/:owner/:volume/*`) additionally accepts PAT Bearer/Basic.
 */

type TestEnv = Record<string, unknown> & { DB: D1Database };

export async function ensureAesSecret(_env: TestEnv): Promise<void> {
  // No Secrets Store binding: PAT hashing is sha256 (no encryption).
}

export async function ensureUser(db: D1Database, email: string, username?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const normalizedEmail = email.toLowerCase();
  const handle = (username ?? normalizedEmail.split('@', 1)[0]).trim() || 'user';
  const handleCi = handle.toLowerCase();
  await db.prepare(`INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)`).bind(normalizedEmail, now).run();
  await db
    .prepare(`UPDATE users SET username = COALESCE(username, ?), updated_at = COALESCE(updated_at, ?) WHERE email = ?`)
    .bind(handle, now, normalizedEmail)
    .run();
  await db
    .prepare(`INSERT OR IGNORE INTO namespaces (username_ci, kind, user_email, created_at) VALUES (?, 'user', ?, ?)`)
    .bind(handleCi, normalizedEmail, now)
    .run();
  return handle;
}

export async function setupIntegrationTest(env: TestEnv, userEmail?: string): Promise<void> {
  await applyMigrations(env.DB);
  await ensureAesSecret(env);
  if (userEmail) {
    await ensureUser(env.DB, userEmail);
  }
}

export async function seedVolume(
  db: D1Database,
  input: {
    ownerEmail: string;
    owner: string;
    name: string;
    isPrivate?: boolean;
    description?: string | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const ownerUsername = await ensureUser(db, input.ownerEmail, input.owner);
  await db
    .prepare(
      `INSERT OR IGNORE INTO dav_volumes (id, owner_email, owner, name, description, is_private, created_at, updated_at, owner_ci, name_ci) ` +
        `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.ownerEmail.toLowerCase(),
      ownerUsername,
      input.name,
      input.description ?? null,
      input.isPrivate === true ? 1 : 0,
      now,
      now,
      ownerUsername.toLowerCase(),
      input.name.toLowerCase(),
    )
    .run();
  return id;
}

// Back-compat alias for older helpers.
export const seedRepo = seedVolume;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mintPatForEmail(
  db: D1Database,
  email: string,
  input: { name?: string; scopes?: string[]; expiresInDays?: number } = {},
): Promise<{ tokenId: string; token: string }> {
  const normalized = email.toLowerCase();
  await ensureUser(db, normalized);
  const tokenId = crypto.randomUUID();
  const raw = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const tokenHash = await sha256Hex(`durable-dav-pat:${raw}`);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (input.expiresInDays ?? 90) * 86_400;
  const scopes = input.scopes ?? ['dav:read', 'dav:write', 'admin'];
  await db
    .prepare(
      `INSERT INTO user_access_tokens (token_id, user_email, token_hash, name, expires_at, last_used_at, created_at, token_prefix) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(tokenId, normalized, tokenHash, input.name ?? 'test-token', expiresAt, now, raw.slice(0, 12))
    .run();
  for (const scope of scopes) {
    await db.prepare(`INSERT OR IGNORE INTO token_scopes (token_id, scope, created_at) VALUES (?, ?, ?)`).bind(tokenId, scope, now).run();
  }
  return { tokenId, token: raw };
}

export function bearerHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function basicAuthHeader(username: string, password: string): Record<string, string> {
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}` };
}

export async function addCollaborator(
  db: D1Database,
  volumeId: string,
  userEmail: string,
  role: 'admin' | 'write' | 'read',
  grantedBy?: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await ensureUser(db, userEmail);
  await db
    .prepare(`INSERT OR REPLACE INTO dav_collaborators (volume_id, user_email, role, granted_by, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(volumeId, userEmail.toLowerCase(), role, grantedBy?.toLowerCase() ?? null, now)
    .run();
}
