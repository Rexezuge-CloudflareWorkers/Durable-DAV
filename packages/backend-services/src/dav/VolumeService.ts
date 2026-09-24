import { DavVolumeDAO, NamespaceDAO, OrganizationDAO, OrganizationMemberDAO } from '@duradav/backend-data/dao';
import type { DavVolumeRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, ForbiddenError, NotFoundError } from '@duradav/backend-errors';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { AppConfiguration } from '@duradav/backend-runtime/config';

interface VolumeServiceEnv {
  DB: D1Queryable;
}

interface VolumeServiceDeps {
  volumeDAO?: () => Promise<DavVolumeDAO>;
  namespaceDAO?: () => Promise<NamespaceDAO>;
  organizationDAO?: () => Promise<OrganizationDAO>;
  organizationMemberDAO?: () => Promise<OrganizationMemberDAO>;
  config?: AppConfiguration;
}

const OWNER_RE = /^[a-z0-9][a-z0-9-]*$/i;
const VOLUME_RE = /^[a-z0-9][\w.-]*$/i;

class VolumeService {
  private readonly deps: Required<VolumeServiceDeps>;

  constructor(
    private readonly env: VolumeServiceEnv,
    deps: VolumeServiceDeps = {},
  ) {
    this.deps = {
      volumeDAO: () => Promise.resolve(new DavVolumeDAO(env.DB)),
      namespaceDAO: () => Promise.resolve(new NamespaceDAO(env.DB)),
      organizationDAO: () => Promise.resolve(new OrganizationDAO(env.DB)),
      organizationMemberDAO: () => Promise.resolve(new OrganizationMemberDAO(env.DB)),
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

  public async getVolume(owner: string, name: string): Promise<DavVolumeRow | null> {
    const dao = await this.deps.volumeDAO();
    return dao.getByOwnerName(owner, name).catch(() => null);
  }

  public async requireVolume(owner: string, name: string): Promise<DavVolumeRow> {
    const volume = await this.getVolume(owner, name);
    if (!volume) throw new NotFoundError('Volume not found');
    return volume;
  }

  public async createVolume(input: {
    owner: string;
    name: string;
    description?: string | null;
    isPrivate?: boolean;
    creatorEmail: string;
  }): Promise<DavVolumeRow> {
    const owner = VolumeService.normalizeOwner(input.owner);
    const name = VolumeService.normalizeName(input.name);
    if (!OWNER_RE.test(owner) || owner.length > 39) throw new BadRequestError('Invalid owner name');
    if (!VOLUME_RE.test(name) || name.length > 100) throw new BadRequestError('Invalid volume name');
    const namespaceDao = await this.deps.namespaceDAO();
    const ns = await namespaceDao.get(owner.toLowerCase()).catch(() => null);
    let ownerType = 'user';
    let orgId: string | null = null;
    let ownerUserEmail: string | null = input.creatorEmail.toLowerCase();
    if (ns && ns.kind === 'org') {
      const orgDao = await this.deps.organizationDAO();
      const org = await orgDao.getByUsernameCi(owner.toLowerCase());
      if (!org) throw new NotFoundError('Organization not found');
      const memberDao = await this.deps.organizationMemberDAO();
      const membership = await memberDao.get(org.id, input.creatorEmail);
      if (!membership) throw new ForbiddenError('Only org owners/members may create org volumes');
      ownerType = 'org';
      orgId = org.id;
      ownerUserEmail = null;
    } else {
      // user namespace: owner must be creator's username (resolved by caller) — enforce case-insensitive match via users table upstream
    }
    const dao = await this.deps.volumeDAO();
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
      isPrivate: input.isPrivate ?? false,
      now,
      ownerType,
      orgId,
      ownerUserEmail,
    });
    const created = await dao.getById(id);
    if (!created) throw new NotFoundError('Volume not found after create');
    return created;
  }

  public async deleteVolume(owner: string, name: string): Promise<void> {
    const volume = await this.requireVolume(owner, name);
    const dao = await this.deps.volumeDAO();
    await dao.deleteById(volume.id);
  }
}

export { VolumeService };
