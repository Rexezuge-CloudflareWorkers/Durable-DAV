import { DeployKeyDAO } from '@duradav/backend-data/dao';
import type { DeployKeyPermission } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { DeployKeyMetadata } from '@duradav/shared';
import { CryptoUtil, TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import type { DeployKeyRow } from '@duradav/backend-data/dao';

interface DeployKeyServiceEnv {
  DB: D1Queryable;
  MAX_DEPLOY_KEYS_PER_REPO?: string;
  MAX_TOKEN_EXPIRY_DAYS?: string;
}

interface DeployKeyServiceDeps {
  deployKeyDAO?: () => Promise<DeployKeyDAO>;
}

interface CreatedDeployKey {
  id: string;
  name: string;
  key: string;
  prefix: string;
  permission: DeployKeyPermission;
  expiresAt: number;
}

function toMetadata(row: DeployKeyRow): DeployKeyMetadata {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    permission: row.permission,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

class DeployKeyService {
  private readonly deps: Required<DeployKeyServiceDeps>;

  constructor(
    private readonly env: DeployKeyServiceEnv,
    deps: DeployKeyServiceDeps = {},
  ) {
    this.deps = {
      deployKeyDAO: () => Promise.resolve(new DeployKeyDAO(env.DB)),
      ...deps,
    };
  }

  public static async hashKey(key: string): Promise<string> {
    return CryptoUtil.sha256Hex(`duradav-deploy:${key}`);
  }

  public static keyPrefix(key: string): string {
    return key.slice(0, 12);
  }

  public static normalizePermission(input: unknown): DeployKeyPermission {
    if (input === 'read' || input === 'write') return input;
    if (input === undefined || input === null) return 'read';
    throw new BadRequestError('permission must be read or write');
  }

  public async createKey(
    repositoryId: string,
    name: string,
    permission: DeployKeyPermission,
    createdBy: string,
    expiresInDays?: number,
  ): Promise<CreatedDeployKey> {
    const clean = name?.trim() ?? '';
    if (clean.length === 0 || clean.length > 100) throw new BadRequestError('name must be 1-100 characters');
    const dao = await this.deps.deployKeyDAO();
    const max = ConfigurationManager.transfer.getMaxDeployKeysPerRepo(this.env);
    if ((await dao.countByRepo(repositoryId).catch(() => 0)) >= max) {
      throw new BadRequestError(`Maximum ${max} deploy keys per repository`);
    }
    const maxExpiry = ConfigurationManager.token.getMaxExpiryDays(this.env);
    const effective = expiresInDays ?? maxExpiry;
    if (!Number.isSafeInteger(effective) || effective <= 0 || effective > maxExpiry) {
      throw new BadRequestError(`expiresInDays must be 1-${maxExpiry}`);
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const raw = CryptoUtil.randomBase64Url(32);
    const hash = await DeployKeyService.hashKey(raw);
    await dao.create({
      id: UUIDUtil.getRandomUUID(),
      repositoryId,
      name: clean,
      tokenHash: hash,
      tokenPrefix: DeployKeyService.keyPrefix(raw),
      permission,
      expiresAt: TimestampUtil.addDays(now, effective),
      createdBy: createdBy.toLowerCase(),
      now,
    });
    const listed = await dao.listByRepo(repositoryId);
    const created = listed.find((r) => r.token_hash === hash);
    if (!created) throw new NotFoundError('Deploy key not found');
    return { id: created.id, name: created.name, key: raw, prefix: created.token_prefix ?? '', permission, expiresAt: created.expires_at };
  }

  public async listKeys(repositoryId: string): Promise<DeployKeyMetadata[]> {
    const dao = await this.deps.deployKeyDAO();
    const rows = await dao.listByRepo(repositoryId);
    return rows.map(toMetadata);
  }

  public async revokeKey(repositoryId: string, keyId: string): Promise<void> {
    const dao = await this.deps.deployKeyDAO();
    const existing = await dao.getByIdAndRepo(keyId, repositoryId).catch(() => null);
    if (!existing) throw new NotFoundError('Deploy key not found');
    await dao.deleteByIdAndRepo(keyId, repositoryId);
  }

  public async authenticateWithKey(key: string): Promise<{ repositoryId: string; permission: DeployKeyPermission } | null> {
    const dao = await this.deps.deployKeyDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const row = await dao.getByTokenHash(await DeployKeyService.hashKey(key), now).catch(() => null);
    if (!row) return null;
    await dao.updateLastUsedByHash(row.token_hash, now).catch(() => undefined);
    return { repositoryId: row.repository_id, permission: row.permission };
  }
}

export { DeployKeyService };
export type { CreatedDeployKey, DeployKeyServiceDeps, DeployKeyServiceEnv };
