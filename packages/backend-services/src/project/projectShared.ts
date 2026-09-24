import type { ProjectCardRow, ProjectColumnRow, ProjectRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError } from '@duradav/backend-errors';
import type { ProjectDAO } from '@duradav/backend-data/dao';
import type { NumberingDAO } from '@duradav/backend-data/dao';
import type { ProjectCardMetadata, ProjectColumnMetadata, ProjectMetadata } from '@duradav/shared';

interface ProjectServiceEnv {
  DB: D1Queryable;
  MAX_PROJECTS_PER_REPO?: string;
  MAX_COLUMNS_PER_PROJECT?: string;
  MAX_CARDS_PER_COLUMN?: string;
}

interface ProjectServiceDeps {
  projectDAO?: () => Promise<ProjectDAO>;
  numberingDAO?: () => Promise<NumberingDAO>;
}

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 1000;
const MAX_NOTE_TITLE = 200;
const MAX_NOTE_BODY = 10_000;

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|constraint/i.test(message);
}

function toMetadata(row: ProjectRow): ProjectMetadata {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status as ProjectMetadata['status'],
    creatorEmail: row.creator_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toColumnMetadata(row: ProjectColumnRow): ProjectColumnMetadata {
  return { id: row.id, projectId: row.project_id, title: row.title, position: row.position, createdAt: row.created_at };
}

function toCardMetadata(row: ProjectCardRow): ProjectCardMetadata {
  return {
    id: row.id,
    projectId: row.project_id,
    columnId: row.column_id,
    kind: row.kind as ProjectCardMetadata['kind'],
    noteTitle: row.note_title,
    noteBody: row.note_body,
    issueId: row.issue_id,
    pullRequestId: row.pull_request_id,
    position: row.position,
    archived: row.archived === 1,
    creatorEmail: row.creator_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new BadRequestError('title is required');
  const title = raw.trim();
  if (title.length > MAX_TITLE) throw new BadRequestError(`title must be at most ${MAX_TITLE} characters`);
  return title;
}

export { isUniqueViolation, toMetadata, toColumnMetadata, toCardMetadata, normalizeTitle };
export { MAX_TITLE, MAX_DESCRIPTION, MAX_NOTE_TITLE, MAX_NOTE_BODY };
export type { ProjectServiceEnv, ProjectServiceDeps };
