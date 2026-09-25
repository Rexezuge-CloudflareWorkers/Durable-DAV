import { ConfigurationManager } from '@durable-dav/backend-runtime/config';
import { DavCredentialDAO } from '@durable-dav/backend-data/dao';
import type { D1Queryable } from '@durable-dav/backend-data/utils';
import { BadRequestError, InternalServerError } from '@durable-dav/backend-errors';
import type { DavCredentialMetadata } from '@durable-dav/shared/model';
import { DavCredentialUtil, TimestampUtil } from '@durable-dav/shared/utils';

interface VolumeCredentialServiceEnv {
  DB: D1Queryable;
  MAX_CREDENTIALS_PER_VOLUME?: string;
  DEFAULT_CREDENTIAL_EXPIRY_DAYS?: string;
  MAX_CREDENTIAL_EXPIRY_DAYS?: string;
}

interface VolumeCredentialServiceDeps {
  credentialDAO?: () => Promise<DavCredentialDAO>;
}

class VolumeCredentialService {
  private readonly deps: Required<VolumeCredentialServiceDeps>;

  constructor(
    private readonly env: VolumeCredentialServiceEnv,
    deps: VolumeCredentialServiceDeps = {},
  ) {
    this.deps = {
      credentialDAO: () => Promise.resolve(new DavCredentialDAO(env.DB)),
      ...deps,
    };
  }

  public static async hashPassword(password: string): Promise<string> {
    return DavCredentialUtil.hashPassword(password);
  }

  public async listCredentials(volumeId: string): Promise<DavCredentialMetadata[]> {
    const dao = await this.deps.credentialDAO();
    return dao.listByVolume(volumeId);
  }

  public async createCredential(
    volumeId: string,
    volumeName: string,
    name: string,
    expiresInDays?: unknown,
  ): Promise<{ password: string; metadata: DavCredentialMetadata }> {
    const dao = await this.deps.credentialDAO();
    const maxCredentials = ConfigurationManager.davCredentials.getMaxPerVolume(this.env);
    if ((await dao.countByVolume(volumeId)) >= maxCredentials) {
      throw new BadRequestError(`Maximum ${maxCredentials} credentials allowed per bucket.`);
    }
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) throw new BadRequestError('name is required');
    if (trimmedName.length > 100) throw new BadRequestError('name must be at most 100 characters');
    const defaultDays = ConfigurationManager.davCredentials.getDefaultExpiryDays(this.env);
    const maxDays = ConfigurationManager.davCredentials.getMaxExpiryDays(this.env);
    let effectiveDays = defaultDays;
    if (expiresInDays !== undefined && expiresInDays !== null) {
      let numeric: unknown = expiresInDays;
      if (typeof expiresInDays === 'string') {
        const trimmed = expiresInDays.trim();
        if (!/^\d+$/.test(trimmed)) throw new BadRequestError('expiresInDays must be a positive integer');
        numeric = Number(trimmed);
      }
      if (!Number.isSafeInteger(numeric) || (numeric as number) < 1) {
        throw new BadRequestError('expiresInDays must be a positive integer');
      }
      const days = numeric as number;
      if (days > maxDays) throw new BadRequestError(`Credential expiry cannot exceed ${maxDays} days.`);
      effectiveDays = days;
    }
    const password = DavCredentialUtil.generatePassword();
    const passwordHash = await DavCredentialUtil.hashPassword(password);
    const expiresAt = TimestampUtil.addDays(TimestampUtil.getCurrentUnixTimestampInSeconds(), effectiveDays);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username = DavCredentialUtil.generateUsername(volumeName);
      if (await dao.usernameExists(username)) continue;
      try {
        const metadata = await dao.create(
          volumeId,
          username,
          passwordHash,
          trimmedName,
          DavCredentialUtil.getPrefix(password),
          DavCredentialUtil.getLastFour(password),
          expiresAt,
        );
        return { password, metadata };
      } catch (error) {
        if (!VolumeCredentialService.isUniqueConstraintError(error)) throw error;
      }
    }
    throw new InternalServerError('Failed to generate a unique credential username.');
  }

  public async deleteCredential(volumeId: string, credentialId: string): Promise<void> {
    const dao = await this.deps.credentialDAO();
    await dao.deleteForVolume(credentialId, volumeId);
  }

  private static isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error && /unique constraint/i.test(error.message);
  }
}

export { VolumeCredentialService };
export type { VolumeCredentialServiceEnv, VolumeCredentialServiceDeps };
