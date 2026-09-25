import { DavCredentialDAO, DavVolumeDAO, UserDAO } from '@durable-dav/backend-data/dao';
import type { DavVolumeRow } from '@durable-dav/backend-data/dao';
import type { D1Queryable } from '@durable-dav/backend-data/utils';
import { BadRequestError, ForbiddenError, NotFoundError } from '@durable-dav/backend-errors';
import { TimestampUtil, UUIDUtil } from '@durable-dav/shared/utils';
import { AppConfiguration } from '@durable-dav/backend-runtime/config';
import { checkVolumeQuota, validateVolumePatch } from './VolumeCreatePolicy';

interface VolumeServiceEnv {
  DB: D1Queryable;
  MAX_VOLUMES_PER_USER?: string;
}

interface VolumeServiceDeps {
  volumeDAO?: () => Promise<DavVolumeDAO>;
  userDAO?: () => Promise<UserDAO>;
  credentialDAO?: () => Promise<DavCredentialDAO>;
  config?: AppConfiguration;
}

const OWNER_RE = /^[a-z0-9][a-z0-9-]*$/i;
const VOLUME_RE = /^[a-z0-9][\w.-]*$/i;

class VolumeService {
  private readonly deps: Required<Pick<VolumeServiceDeps, 'volumeDAO' | 'userDAO' | 'credentialDAO' | 'config'>>;

  constructor(
    private readonly env: VolumeServiceEnv,
    deps: VolumeServiceDeps = {},
  ) {
    this.deps = {
      volumeDAO: () => Promise.resolve(new DavVolumeDAO(env.DB)),
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      credentialDAO: () => Promise.resolve(new DavCredentialDAO(env.DB)),
      config: AppConfiguration.fromEnv(env),
      ...deps,
    };
  }

  public static normalizeOwner(owner: string): string {
    return owner.trim();
  }

  public static normalizeName(name: string): string {
    return name.trim();
  }

  private static assertValidOwner(owner: string): void {
    if (!OWNER_RE.test(owner) || owner.length > 39) throw new BadRequestError('Invalid owner name');
  }

  private static assertValidName(name: string): void {
    if (!VOLUME_RE.test(name) || name.length > 100) throw new BadRequestError('Invalid volume name');
  }

  private async countOwnedVolumes(creatorEmail: string): Promise<number> {
    const dao = await this.deps.volumeDAO();
    // Prefer COUNT(*) over listing rows (why: listing 1000 rows to count
    // wastes D1 reads and truncates above the limit). Fall back to list
    // length for fake-DB doubles without COUNT support.
    try {
      return await dao.countByOwnerEmail(creatorEmail.toLowerCase());
    } catch {
      const owned = await dao.listByOwnerEmail(creatorEmail.toLowerCase(), 1000).catch(() => []);
      return owned.length;
    }
  }

  public async getVolume(owner: string, name: string): Promise<DavVolumeRow | null> {
    const dao = await this.deps.volumeDAO();
    return dao.getByOwnerName(owner, name).catch(() => null);
  }

  public async requireVolume(owner: string, name: string): Promise<DavVolumeRow> {
    const volume = await this.getVolume(owner, name);
    if (!volume) throw new NotFoundError('Volume not found');
    return volume;
  }

  private async resolveCallerUsername(creatorEmail: string): Promise<string | null> {
    try {
      const userDao = await this.deps.userDAO();
      const row = await userDao.getByEmail(creatorEmail).catch(() => null);
      const username = (row as { username?: string | null } | null)?.username;
      return typeof username === 'string' && username.length > 0 ? username.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  public async createVolume(input: {
    owner: string;
    name: string;
    description?: string | null;
    isPrivate?: boolean;
    creatorEmail: string;
  }): Promise<DavVolumeRow> {
    const owner = VolumeService.normalizeOwner(input.owner);
    VolumeService.assertValidOwner(owner);
    const name = VolumeService.normalizeName(input.name);
    VolumeService.assertValidName(name);
    // User-only buckets: no org volumes. Owner must be the caller's username
    // (case-insensitive) when the username is known; legacy rows without a
    // users entry fall through to the quota + uniqueness checks below.
    const callerUsername = await this.resolveCallerUsername(input.creatorEmail);
    if (callerUsername && owner.toLowerCase() !== callerUsername) {
      throw new ForbiddenError('Only the bucket owner can create buckets for this user');
    }
    const dao = await this.deps.volumeDAO();
    const ownedCount = await this.countOwnedVolumes(input.creatorEmail);
    // Fail-open on outage: quota is soft, auth stays fail-closed.
    checkVolumeQuota(ownedCount, this.deps.config.getMaxVolumesPerUser());
    const existing = await dao.getByOwnerName(owner, name).catch(() => null);
    if (existing) throw new BadRequestError('Volume already exists');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.create({
      id,
      ownerEmail: input.creatorEmail.toLowerCase(),
      owner,
      name,
      description: input.description ?? null,
      isPrivate: input.isPrivate ?? true,
      now,
    });
    const created = await dao.getById(id);
    if (!created) throw new NotFoundError('Volume not found after create');
    return created;
  }

  public async updateVolume(
    owner: string,
    name: string,
    callerEmail: string,
    patch: { description?: string | null; isPrivate?: boolean },
  ): Promise<DavVolumeRow> {
    validateVolumePatch(patch);
    const volume = await this.requireVolume(owner, name);
    if (volume.owner_email.toLowerCase() !== callerEmail.toLowerCase()) {
      throw new ForbiddenError('Only the bucket owner can update this bucket');
    }
    if (patch.description === undefined && patch.isPrivate === undefined) {
      throw new BadRequestError('Nothing to update');
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const dao = await this.deps.volumeDAO();
    await dao.update(volume.id, { description: patch.description, isPrivate: patch.isPrivate, now });
    const updated = await dao.getById(volume.id);
    if (!updated) throw new NotFoundError('Volume not found after update');
    return updated;
  }

  public async deleteVolume(owner: string, name: string): Promise<void> {
    const volume = await this.requireVolume(owner, name);
    // Best-effort credential cleanup. FK cascades cover D1, but explicit
    // deletes keep fake-DB tests honest.
    await this.deps.credentialDAO().then((d) => d.deleteByVolume(volume.id).catch(() => undefined));
    const dao = await this.deps.volumeDAO();
    await dao.deleteById(volume.id);
  }
}

export { VolumeService };
export type { VolumeServiceDeps, VolumeServiceEnv };
