import { SnippetDAO } from '@duradav/backend-data/dao';
import type { SnippetRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, ForbiddenError, NotFoundError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { SnippetFileMetadata, SnippetMetadata } from '@duradav/shared';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';

interface SnippetServiceEnv {
  DB: D1Queryable;
  MAX_SNIPPETS_PER_USER?: string;
  MAX_FILES_PER_SNIPPET?: string;
  MAX_SNIPPET_BYTES?: string;
}

interface SnippetServiceDeps {
  snippetDAO?: () => Promise<SnippetDAO>;
}

const MAX_TITLE = 200;
const MAX_FILENAME = 255;
const FILENAME_RE = /^[\w.][\w. ()-]{0,253}$/;

function toMetadata(row: SnippetRow): SnippetMetadata {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    title: row.title,
    visibility: row.visibility as SnippetMetadata['visibility'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTitle(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new BadRequestError('title must be a string');
  return raw.trim().slice(0, MAX_TITLE);
}

function normalizeVisibility(raw: unknown): 'public' | 'secret' {
  if (raw === undefined || raw === null) return 'public';
  if (raw !== 'public' && raw !== 'secret') throw new BadRequestError('visibility must be public or secret');
  return raw;
}

function normalizeFiles(raw: unknown, maxFiles: number, maxBytes: number): Array<{ filename: string; body: string }> {
  if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestError('files must be a non-empty array');
  if (raw.length > maxFiles) throw new BadRequestError(`at most ${maxFiles} files per snippet`);
  const seen = new Set<string>();
  const out: Array<{ filename: string; body: string }> = [];
  let total = 0;
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) throw new BadRequestError('each file must have filename and body');
    const { filename, body } = entry as { filename?: unknown; body?: unknown };
    if (typeof filename !== 'string' || !filename.trim()) throw new BadRequestError('each file needs a filename');
    const name = filename.trim();
    if (name.length > MAX_FILENAME || !FILENAME_RE.test(name)) throw new BadRequestError(`invalid filename: ${name}`);
    if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new BadRequestError(`invalid filename: ${name}`);
    if (seen.has(name.toLowerCase())) throw new BadRequestError(`duplicate filename: ${name}`);
    seen.add(name.toLowerCase());
    if (typeof body !== 'string') throw new BadRequestError('each file needs a string body');
    total += body.length;
    if (total > maxBytes) throw new BadRequestError(`snippet must be at most ${maxBytes} bytes total`);
    out.push({ filename: name, body });
  }
  return out;
}

class SnippetService {
  private readonly deps: Required<SnippetServiceDeps>;

  constructor(
    private readonly env: SnippetServiceEnv,
    deps: SnippetServiceDeps = {},
  ) {
    this.deps = {
      snippetDAO: () => Promise.resolve(new SnippetDAO(env.DB)),
      ...deps,
    };
  }

  public async createSnippet(
    ownerEmail: string,
    input: { title?: unknown; visibility?: unknown; files: unknown },
  ): Promise<{ snippet: SnippetMetadata; files: SnippetFileMetadata[] }> {
    const email = ownerEmail.toLowerCase();
    const title = normalizeTitle(input.title);
    const visibility = normalizeVisibility(input.visibility);
    const maxFiles = ConfigurationManager.collabSurfaces.getMaxFilesPerSnippet(this.env);
    const maxBytes = ConfigurationManager.collabSurfaces.getMaxSnippetBytes(this.env);
    const files = normalizeFiles(input.files, maxFiles, maxBytes);
    const dao = await this.deps.snippetDAO();
    const max = ConfigurationManager.collabSurfaces.getMaxSnippetsPerUser(this.env);
    const count = await dao.countByOwner(email).catch(() => 0);
    if (count >= max) throw new BadRequestError(`Maximum ${max} snippets per user`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.createSnippet({ id, ownerEmail: email, title, visibility, now });
    for (const file of files) {
      await dao.addFile({ id: UUIDUtil.getRandomUUID(), snippetId: id, filename: file.filename, body: file.body, now });
    }
    return this.getSnippet(id, email);
  }

  public async getSnippet(id: string, viewerEmail: string | null): Promise<{ snippet: SnippetMetadata; files: SnippetFileMetadata[] }> {
    const dao = await this.deps.snippetDAO();
    const row = await dao.getById(id);
    if (!row) throw new NotFoundError('Snippet not found');
    if (row.visibility === 'secret' && row.owner_email !== (viewerEmail ?? '').toLowerCase()) throw new NotFoundError('Snippet not found');
    const files = await dao.listFiles(id).catch(() => []);
    return {
      snippet: toMetadata(row),
      files: files.map((f) => ({ id: f.id, snippetId: f.snippet_id, filename: f.filename, body: f.body, createdAt: f.created_at })),
    };
  }

  public async listByOwner(ownerEmail: string, viewerEmail: string | null): Promise<SnippetMetadata[]> {
    const dao = await this.deps.snippetDAO();
    const email = ownerEmail.toLowerCase();
    const includeSecret = email === (viewerEmail ?? '').toLowerCase();
    const rows = await dao.listByOwner(email, includeSecret).catch(() => []);
    return rows.map(toMetadata);
  }

  public async listPublic(limit = 20): Promise<SnippetMetadata[]> {
    const dao = await this.deps.snippetDAO();
    const rows = await dao.listPublic(Math.min(Math.max(limit, 1), 50)).catch(() => []);
    return rows.map(toMetadata);
  }

  public async updateSnippet(
    id: string,
    ownerEmail: string,
    input: { title?: unknown; visibility?: unknown; files?: unknown },
  ): Promise<{ snippet: SnippetMetadata; files: SnippetFileMetadata[] }> {
    const dao = await this.deps.snippetDAO();
    const row = await dao.getById(id);
    if (!row) throw new NotFoundError('Snippet not found');
    if (row.owner_email !== ownerEmail.toLowerCase()) throw new ForbiddenError('Only the snippet owner can update it');
    const patch: { title?: string; visibility?: string } = {};
    if (input.title !== undefined) patch.title = normalizeTitle(input.title);
    if (input.visibility !== undefined) patch.visibility = normalizeVisibility(input.visibility);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.updateSnippet(id, patch, now);
    if (input.files !== undefined) {
      const maxFiles = ConfigurationManager.collabSurfaces.getMaxFilesPerSnippet(this.env);
      const maxBytes = ConfigurationManager.collabSurfaces.getMaxSnippetBytes(this.env);
      const files = normalizeFiles(input.files, maxFiles, maxBytes);
      await dao.replaceFiles(id, files, now);
    }
    return this.getSnippet(id, ownerEmail);
  }

  public async deleteSnippet(id: string, ownerEmail: string): Promise<{ id: string }> {
    const dao = await this.deps.snippetDAO();
    const row = await dao.getById(id);
    if (!row) throw new NotFoundError('Snippet not found');
    if (row.owner_email !== ownerEmail.toLowerCase()) throw new ForbiddenError('Only the snippet owner can delete it');
    await dao.deleteSnippet(id);
    return { id };
  }
}

export { SnippetService };
export type { SnippetServiceDeps, SnippetServiceEnv };
