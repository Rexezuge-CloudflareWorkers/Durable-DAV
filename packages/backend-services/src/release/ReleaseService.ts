import { ReleaseDAO } from '@duradav/backend-data/dao';
import type { ReleaseAssetRow, ReleaseRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { ReleaseAssetMetadata, ReleaseMetadata } from '@duradav/shared';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import {
  isValidTagName,
  normalizeAssetName,
  normalizeAssetSha256,
  normalizeContentType,
  normalizeReleaseBody,
  normalizeReleaseName,
  normalizeTagName,
} from './ReleaseValidation';

interface ReleaseServiceEnv {
  DB: D1Queryable;
  MAX_RELEASES_PER_REPO?: string;
  MAX_ASSETS_PER_RELEASE?: string;
  MAX_ASSET_BYTES?: string;
}

interface ReleaseServiceDeps {
  releaseDAO?: () => Promise<ReleaseDAO>;
}

function toReleaseMetadata(row: ReleaseRow): ReleaseMetadata {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    tagName: row.tag_name,
    name: row.name,
    body: row.body,
    isDraft: row.is_draft === 1,
    isPrerelease: row.is_prerelease === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function toAssetMetadata(row: ReleaseAssetRow): ReleaseAssetMetadata {
  return {
    id: row.id,
    releaseId: row.release_id,
    repositoryId: row.repository_id,
    name: row.name,
    size: row.size,
    contentType: row.content_type,
    sha256: row.sha256,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

class ReleaseService {
  private readonly deps: Required<ReleaseServiceDeps>;

  constructor(
    private readonly env: ReleaseServiceEnv,
    deps: ReleaseServiceDeps = {},
  ) {
    this.deps = {
      releaseDAO: () => Promise.resolve(new ReleaseDAO(env.DB)),
      ...deps,
    };
  }

  public static isValidTagName(tag: string): boolean {
    return isValidTagName(tag);
  }

  public async createRelease(
    repositoryId: string,
    input: { tagName: unknown; name?: unknown; body?: unknown; isDraft?: unknown; isPrerelease?: unknown },
    creatorEmail: string,
  ): Promise<ReleaseMetadata> {
    const tagName = normalizeTagName(input.tagName);
    const name = normalizeReleaseName(input.name);
    const body = normalizeReleaseBody(input.body);
    if (input.isDraft !== undefined && typeof input.isDraft !== 'boolean') throw new BadRequestError('isDraft must be a boolean');
    if (input.isPrerelease !== undefined && typeof input.isPrerelease !== 'boolean')
      throw new BadRequestError('isPrerelease must be a boolean');
    const isDraft = input.isDraft ?? true;
    const isPrerelease = input.isPrerelease ?? false;
    const dao = await this.deps.releaseDAO();
    const existing = await dao.getByTag(repositoryId, tagName).catch(() => null);
    if (existing) throw new BadRequestError('a release for this tag already exists');
    const max = ConfigurationManager.releases.getMaxPerRepo(this.env);
    const count = await dao.countByRepo(repositoryId).catch(() => 0);
    if (count >= max) throw new BadRequestError(`Maximum ${max} releases per repository`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.createRelease({
      id,
      repositoryId,
      tagName,
      name,
      body,
      isDraft,
      isPrerelease,
      createdBy: creatorEmail.toLowerCase(),
      now,
      publishedAt: isDraft ? null : now,
    });
    return {
      id,
      repositoryId,
      tagName,
      name,
      body,
      isDraft,
      isPrerelease,
      createdBy: creatorEmail.toLowerCase(),
      createdAt: now,
      publishedAt: isDraft ? null : now,
    };
  }

  public async listReleases(repositoryId: string): Promise<ReleaseMetadata[]> {
    const dao = await this.deps.releaseDAO();
    const rows = await dao.listByRepo(repositoryId).catch(() => []);
    return rows.map(toReleaseMetadata);
  }

  public async getRelease(repositoryId: string, tagName: string): Promise<ReleaseMetadata> {
    const tag = normalizeTagName(tagName);
    const dao = await this.deps.releaseDAO();
    const row = await dao.getByTag(repositoryId, tag);
    if (!row) throw new NotFoundError('Release not found');
    return toReleaseMetadata(row);
  }

  public async updateRelease(
    repositoryId: string,
    tagName: string,
    input: { name?: unknown; body?: unknown; isDraft?: unknown; isPrerelease?: unknown },
  ): Promise<ReleaseMetadata> {
    const tag = normalizeTagName(tagName);
    const dao = await this.deps.releaseDAO();
    const row = await dao.getByTag(repositoryId, tag);
    if (!row) throw new NotFoundError('Release not found');
    const patch: { name?: string; body?: string; isDraft?: boolean; isPrerelease?: boolean; publishedAt?: number | null } = {};
    if (input.name !== undefined) patch.name = normalizeReleaseName(input.name);
    if (input.body !== undefined) patch.body = normalizeReleaseBody(input.body);
    if (input.isDraft !== undefined) {
      if (typeof input.isDraft !== 'boolean') throw new BadRequestError('isDraft must be a boolean');
      patch.isDraft = input.isDraft;
      // Publishing a draft stamps published_at; re-drafting keeps history.
      if (row.is_draft === 1 && !input.isDraft && row.published_at === null) {
        patch.publishedAt = TimestampUtil.getCurrentUnixTimestampInSeconds();
      }
    }
    if (input.isPrerelease !== undefined) {
      if (typeof input.isPrerelease !== 'boolean') throw new BadRequestError('isPrerelease must be a boolean');
      patch.isPrerelease = input.isPrerelease;
    }
    await dao.updateRelease(row.id, repositoryId, patch);
    const updated = await dao.getByTag(repositoryId, tag);
    if (!updated) throw new NotFoundError('Release not found');
    return toReleaseMetadata(updated);
  }

  public async deleteRelease(repositoryId: string, tagName: string): Promise<{ id: string }> {
    const tag = normalizeTagName(tagName);
    const dao = await this.deps.releaseDAO();
    const row = await dao.getByTag(repositoryId, tag);
    if (!row) throw new NotFoundError('Release not found');
    await dao.deleteRelease(row.id, repositoryId);
    return { id: row.id };
  }

  public async getReleaseRow(repositoryId: string, tagName: string): Promise<ReleaseRow> {
    const tag = normalizeTagName(tagName);
    const dao = await this.deps.releaseDAO();
    const row = await dao.getByTag(repositoryId, tag);
    if (!row) throw new NotFoundError('Release not found');
    return row;
  }

  public async createAsset(
    repositoryId: string,
    tagName: string,
    input: { name: unknown; size: number; contentType?: unknown; sha256: string },
    creatorEmail: string,
  ): Promise<ReleaseAssetMetadata> {
    const row = await this.getReleaseRow(repositoryId, tagName);
    const name = normalizeAssetName(input.name);
    const contentType = normalizeContentType(input.contentType);
    const sha256 = normalizeAssetSha256(input.sha256);
    const maxBytes = ConfigurationManager.releases.getMaxAssetBytes(this.env);
    const byteCount = input.size;
    if (!Number.isSafeInteger(byteCount) || byteCount <= 0 || byteCount > maxBytes)
      throw new BadRequestError(`asset size must be 1-${maxBytes} bytes`);
    const dao = await this.deps.releaseDAO();
    const existing = await dao.getAssetByName(row.id, name).catch(() => null);
    if (existing) throw new BadRequestError('an asset with this name already exists');
    const maxAssets = ConfigurationManager.releases.getMaxAssetsPerRelease(this.env);
    const count = await dao.countAssets(row.id).catch(() => 0);
    if (count >= maxAssets) throw new BadRequestError(`Maximum ${maxAssets} assets per release`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.createAsset({
      id,
      releaseId: row.id,
      repositoryId,
      name,
      size: input.size,
      contentType,
      sha256,
      createdBy: creatorEmail.toLowerCase(),
      now,
    });
    return {
      id,
      releaseId: row.id,
      repositoryId,
      name,
      size: input.size,
      contentType,
      sha256,
      createdBy: creatorEmail.toLowerCase(),
      createdAt: now,
    };
  }

  public async listAssets(repositoryId: string, tagName: string): Promise<ReleaseAssetMetadata[]> {
    const row = await this.getReleaseRow(repositoryId, tagName);
    const dao = await this.deps.releaseDAO();
    const rows = await dao.listAssets(row.id).catch(() => []);
    return rows.map(toAssetMetadata);
  }

  public async getAsset(repositoryId: string, tagName: string, assetId: string): Promise<ReleaseAssetMetadata> {
    const row = await this.getReleaseRow(repositoryId, tagName);
    const dao = await this.deps.releaseDAO();
    const asset = await dao.getAsset(assetId, row.id);
    if (!asset) throw new NotFoundError('Release asset not found');
    return toAssetMetadata(asset);
  }

  public async deleteAsset(repositoryId: string, tagName: string, assetId: string): Promise<{ id: string }> {
    const row = await this.getReleaseRow(repositoryId, tagName);
    const dao = await this.deps.releaseDAO();
    const asset = await dao.getAsset(assetId, row.id);
    if (!asset) throw new NotFoundError('Release asset not found');
    await dao.deleteAsset(assetId, row.id);
    return { id: assetId };
  }
}

export { ReleaseService };
export { TAG_NAME_RE } from './ReleaseValidation';
export type { ReleaseServiceDeps, ReleaseServiceEnv };
