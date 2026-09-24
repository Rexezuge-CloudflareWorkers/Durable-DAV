import { ProjectDAO } from '@duradav/backend-data/dao';
import { NumberingDAO } from '@duradav/backend-data/dao';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { ProjectCardMetadata, ProjectColumnMetadata, ProjectMetadata } from '@duradav/shared';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { allocateNumberWithFallback } from '../numbering/numberAllocator';
import { ProjectBoardService } from './ProjectBoardService';
import { MAX_DESCRIPTION, isUniqueViolation, normalizeTitle, toMetadata } from './projectShared';
import type { ProjectServiceDeps, ProjectServiceEnv } from './projectShared';

// Project CRUD facade. Board logic (columns, cards, full-board read) lives in
// `ProjectBoardService`; this class keeps project-level CRUD plus delegation
// so the public API and constructor shape are unchanged.
class ProjectService {
  private readonly deps: Required<ProjectServiceDeps>;
  private readonly board: ProjectBoardService;

  constructor(
    private readonly env: ProjectServiceEnv,
    deps: ProjectServiceDeps = {},
  ) {
    const daoThunk = deps.projectDAO ?? (() => Promise.resolve(new ProjectDAO(env.DB)));
    const numberingThunk = deps.numberingDAO ?? (() => Promise.resolve(new NumberingDAO(env.DB)));
    this.deps = { projectDAO: daoThunk, numberingDAO: numberingThunk };
    this.board = new ProjectBoardService(env, { projectDAO: daoThunk });
  }

  public async createProject(
    repositoryId: string,
    input: { title: unknown; description?: unknown },
    creatorEmail: string,
  ): Promise<ProjectMetadata> {
    const title = normalizeTitle(input.title);
    const description =
      input.description === undefined || input.description === null
        ? null
        : typeof input.description === 'string'
          ? input.description.trim().slice(0, MAX_DESCRIPTION) || null
          : (() => {
              throw new BadRequestError('description must be a string');
            })();
    const dao = await this.deps.projectDAO();
    const max = ConfigurationManager.collabSurfaces.getMaxProjectsPerRepo(this.env);
    const count = await dao.countByRepo(repositoryId).catch(() => 0);
    if (count >= max) throw new BadRequestError(`Maximum ${max} projects per repository`);
    // Atomic allocator first; legacy nextNumber on fallback (see IssueService).
    // Retry on UNIQUE(repository_id, number) races from concurrent POSTs.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
      const id = UUIDUtil.getRandomUUID();
      const number = await allocateNumberWithFallback(this.deps.numberingDAO, () => dao.nextNumber(repositoryId), repositoryId, 'project');
      try {
        await dao.createProject({ id, repositoryId, number, title, description, creatorEmail: creatorEmail.toLowerCase(), now });
        // Seed the canonical three columns so boards are usable immediately.
        const seeds: Array<{ title: string; position: number }> = [
          { title: 'Todo', position: 0 },
          { title: 'In Progress', position: 1 },
          { title: 'Done', position: 2 },
        ];
        for (const seed of seeds) {
          await dao
            .createColumn({ id: UUIDUtil.getRandomUUID(), projectId: id, title: seed.title, position: seed.position, now })
            .catch(() => undefined);
        }
        const row = await dao.getById(id, repositoryId);
        if (!row) throw new NotFoundError('Project not found');
        return toMetadata(row);
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        lastError = error;
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new BadRequestError('Failed to create project');
  }

  public async listProjects(repositoryId: string): Promise<ProjectMetadata[]> {
    const dao = await this.deps.projectDAO();
    const rows = await dao.listByRepo(repositoryId).catch(() => []);
    return rows.map(toMetadata);
  }

  public async getProject(repositoryId: string, number: number): Promise<ProjectMetadata> {
    const dao = await this.deps.projectDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Project not found');
    return toMetadata(row);
  }

  public async updateProject(
    repositoryId: string,
    number: number,
    input: { title?: unknown; description?: unknown },
  ): Promise<ProjectMetadata> {
    const dao = await this.deps.projectDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Project not found');
    const patch: { title?: string; description?: string | null } = {};
    if (input.title !== undefined) patch.title = normalizeTitle(input.title);
    if (input.description !== undefined) {
      if (input.description !== null && typeof input.description !== 'string') throw new BadRequestError('description must be a string');
      patch.description = input.description === null ? null : input.description.trim().slice(0, MAX_DESCRIPTION) || null;
    }
    await dao.updateProject(row.id, repositoryId, patch, TimestampUtil.getCurrentUnixTimestampInSeconds());
    const updated = await dao.getByNumber(repositoryId, number);
    if (!updated) throw new NotFoundError('Project not found');
    return toMetadata(updated);
  }

  public async setStatus(repositoryId: string, number: number, status: unknown): Promise<ProjectMetadata> {
    if (status !== 'open' && status !== 'closed') throw new BadRequestError('status must be open or closed');
    const dao = await this.deps.projectDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Project not found');
    await dao.setStatus(row.id, repositoryId, status, TimestampUtil.getCurrentUnixTimestampInSeconds());
    const updated = await dao.getByNumber(repositoryId, number);
    if (!updated) throw new NotFoundError('Project not found');
    return toMetadata(updated);
  }

  public async deleteProject(repositoryId: string, number: number): Promise<{ id: string }> {
    const dao = await this.deps.projectDAO();
    const row = await dao.getByNumber(repositoryId, number);
    if (!row) throw new NotFoundError('Project not found');
    await dao.deleteProject(row.id, repositoryId);
    return { id: row.id };
  }

  public async getProjectBoard(
    repositoryId: string,
    number: number,
  ): Promise<{ project: ProjectMetadata; columns: ProjectColumnMetadata[]; cards: ProjectCardMetadata[] }> {
    return this.board.getProjectBoard(repositoryId, number);
  }

  public async createColumn(repositoryId: string, projectNumber: number, input: { title: unknown }): Promise<ProjectColumnMetadata> {
    return this.board.createColumn(repositoryId, projectNumber, input);
  }

  public async renameColumn(
    repositoryId: string,
    projectNumber: number,
    columnId: string,
    input: { title: unknown },
  ): Promise<ProjectColumnMetadata> {
    return this.board.renameColumn(repositoryId, projectNumber, columnId, input);
  }

  public async deleteColumn(repositoryId: string, projectNumber: number, columnId: string): Promise<{ id: string }> {
    return this.board.deleteColumn(repositoryId, projectNumber, columnId);
  }

  public async createCard(
    repositoryId: string,
    projectNumber: number,
    input: { columnId: unknown; kind?: unknown; noteTitle?: unknown; noteBody?: unknown; issueId?: unknown; pullRequestId?: unknown },
    creatorEmail: string,
  ): Promise<ProjectCardMetadata> {
    return this.board.createCard(repositoryId, projectNumber, input, creatorEmail);
  }

  public async moveCard(
    repositoryId: string,
    projectNumber: number,
    cardId: string,
    input: { toColumnId: unknown; position?: unknown },
  ): Promise<ProjectCardMetadata> {
    return this.board.moveCard(repositoryId, projectNumber, cardId, input);
  }

  public async setCardArchived(
    repositoryId: string,
    projectNumber: number,
    cardId: string,
    archived: unknown,
  ): Promise<ProjectCardMetadata> {
    return this.board.setCardArchived(repositoryId, projectNumber, cardId, archived);
  }

  public async deleteCard(repositoryId: string, projectNumber: number, cardId: string): Promise<{ id: string }> {
    return this.board.deleteCard(repositoryId, projectNumber, cardId);
  }
}

export { ProjectService };
export { ProjectBoardService } from './ProjectBoardService';
export type { ProjectServiceDeps, ProjectServiceEnv } from './projectShared';
