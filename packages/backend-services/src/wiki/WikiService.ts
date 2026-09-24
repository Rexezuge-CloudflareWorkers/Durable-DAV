import { WikiDAO } from '@duradav/backend-data/dao';
import type { WikiPageRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { WikiPageMetadata, WikiRevisionMetadata } from '@duradav/shared';
import { TimestampUtil, UUIDUtil, SLUG_RE } from '@duradav/shared/utils';

interface WikiServiceEnv {
  DB: D1Queryable;
  MAX_WIKI_PAGES_PER_REPO?: string;
  MAX_WIKI_BODY_BYTES?: string;
}

interface WikiServiceDeps {
  wikiDAO?: () => Promise<WikiDAO>;
}

const MAX_SLUG = 100;
const MAX_TITLE = 200;

function toMetadata(row: WikiPageRow): WikiPageMetadata {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    revision: row.revision,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSlug(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new BadRequestError('slug is required');
  const slug = raw.trim().toLowerCase();
  // Canonical charset from @duradav/shared SLUG_RE plus wiki hyphen rules.
  // Linear-time check (no nested quantifiers): charset + hyphen rules.
  if (slug.length > MAX_SLUG || !SLUG_RE.test(slug) || slug.startsWith('-') || slug.endsWith('-') || slug.includes('--'))
    throw new BadRequestError('slug must be 1-100 lowercase alphanumerics and hyphens');
  return slug;
}

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new BadRequestError('title is required');
  const title = raw.trim();
  if (title.length > MAX_TITLE) throw new BadRequestError(`title must be at most ${MAX_TITLE} characters`);
  return title;
}

class WikiService {
  private readonly deps: Required<WikiServiceDeps>;

  constructor(
    private readonly env: WikiServiceEnv,
    deps: WikiServiceDeps = {},
  ) {
    this.deps = {
      wikiDAO: () => Promise.resolve(new WikiDAO(env.DB)),
      ...deps,
    };
  }

  public static slugify(raw: string): string {
    // Linear-time slugify without regex (sonar-safe): map runs of
    // non-alphanumerics to a single hyphen, then trim edge hyphens.
    const lower = raw.trim().toLowerCase();
    let out = '';
    let lastWasHyphen = true;
    for (const ch of lower) {
      const alnum = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
      if (alnum) {
        out += ch;
        lastWasHyphen = false;
      } else if (!lastWasHyphen) {
        out += '-';
        lastWasHyphen = true;
      }
    }
    if (out.endsWith('-')) out = out.slice(0, -1);
    return out.slice(0, MAX_SLUG);
  }

  /*
   * @deprecated Use slugify; kept for compat until callers migrate.
   */
  public static normalizeSlug(raw: string): string {
    return this.slugify(raw);
  }

  public async createPage(
    repositoryId: string,
    input: { slug: unknown; title: unknown; body?: unknown },
    authorEmail: string,
  ): Promise<WikiPageMetadata> {
    const slug = normalizeSlug(input.slug);
    const title = normalizeTitle(input.title);
    const maxBytes = ConfigurationManager.collabSurfaces.getMaxWikiBodyBytes(this.env);
    const rawBody: unknown = input.body ?? '';
    if (typeof rawBody !== 'string') throw new BadRequestError('body must be a string');
    const body = rawBody;
    if (body.length > maxBytes) throw new BadRequestError(`body must be at most ${maxBytes} bytes`);
    const dao = await this.deps.wikiDAO();
    const existing = await dao.getBySlug(repositoryId, slug).catch(() => null);
    if (existing) throw new BadRequestError('a wiki page with this slug already exists');
    const max = ConfigurationManager.collabSurfaces.getMaxWikiPagesPerRepo(this.env);
    const count = await dao.countByRepo(repositoryId).catch(() => 0);
    if (count >= max) throw new BadRequestError(`Maximum ${max} wiki pages per repository`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    try {
      await dao.createPage({ id, repositoryId, slug, title, body, authorEmail: authorEmail.toLowerCase(), now });
    } catch {
      throw new BadRequestError('a wiki page with this slug already exists');
    }
    const row = await dao.getBySlug(repositoryId, slug);
    if (!row) throw new NotFoundError('Wiki page not found');
    return toMetadata(row);
  }

  public async listPages(repositoryId: string): Promise<WikiPageMetadata[]> {
    const dao = await this.deps.wikiDAO();
    const rows = await dao.listByRepo(repositoryId).catch(() => []);
    return rows.map(toMetadata);
  }

  public async getPage(repositoryId: string, slug: string): Promise<WikiPageMetadata> {
    const dao = await this.deps.wikiDAO();
    const row = await dao.getBySlug(repositoryId, normalizeSlug(slug));
    if (!row) throw new NotFoundError('Wiki page not found');
    return toMetadata(row);
  }

  public async updatePage(
    repositoryId: string,
    slug: string,
    input: { title?: unknown; body?: unknown; expectedRevision?: unknown },
    authorEmail: string,
  ): Promise<WikiPageMetadata> {
    const dao = await this.deps.wikiDAO();
    const row = await dao.getBySlug(repositoryId, normalizeSlug(slug));
    if (!row) throw new NotFoundError('Wiki page not found');
    let expectedRevision: number | undefined;
    if (input.expectedRevision !== undefined) {
      if (typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
        throw new BadRequestError('expectedRevision must be a positive integer');
      expectedRevision = input.expectedRevision;
    }
    let title: string | undefined;
    if (input.title !== undefined) title = normalizeTitle(input.title);
    let body: string | undefined;
    if (input.body !== undefined) {
      if (typeof input.body !== 'string') throw new BadRequestError('body must be a string');
      const maxBytes = ConfigurationManager.collabSurfaces.getMaxWikiBodyBytes(this.env);
      if (input.body.length > maxBytes) throw new BadRequestError(`body must be at most ${maxBytes} bytes`);
      body = input.body;
    }
    // Optimistic-concurrency conflicts stay plain Errors with a
    // `revision conflict` prefix; routes map them to 409 (same pattern as
    // the git DO's 409 statuses — no ConflictError class exists).
    const updated = await dao.updatePage(
      row.id,
      repositoryId,
      { title, body, expectedRevision },
      authorEmail.toLowerCase(),
      TimestampUtil.getCurrentUnixTimestampInSeconds(),
    );
    return toMetadata(updated);
  }

  public async deletePage(repositoryId: string, slug: string): Promise<{ id: string }> {
    const dao = await this.deps.wikiDAO();
    const row = await dao.getBySlug(repositoryId, normalizeSlug(slug));
    if (!row) throw new NotFoundError('Wiki page not found');
    await dao.deletePage(row.id, repositoryId);
    return { id: row.id };
  }

  public async listRevisions(repositoryId: string, slug: string): Promise<WikiRevisionMetadata[]> {
    const dao = await this.deps.wikiDAO();
    const row = await dao.getBySlug(repositoryId, normalizeSlug(slug));
    if (!row) throw new NotFoundError('Wiki page not found');
    const rows = await dao.listRevisions(row.id).catch(() => []);
    return rows.map((r) => ({
      id: r.id,
      pageId: r.page_id,
      revision: r.revision,
      body: r.body,
      authorEmail: r.author_email,
      createdAt: r.created_at,
    }));
  }

  public async searchPages(repositoryId: string, term: string, limit = 20): Promise<WikiPageMetadata[]> {
    const dao = await this.deps.wikiDAO();
    const rows = await dao.searchByRepo(repositoryId, term.slice(0, 200), Math.min(Math.max(limit, 1), 50)).catch(() => []);
    return rows.map(toMetadata);
  }
}

export { WikiService };
export type { WikiServiceDeps, WikiServiceEnv };
