import { StarDAO } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { TimestampUtil } from '@duradav/shared/utils';

interface StarServiceEnv {
  DB: D1Queryable;
}

interface StarServiceDeps {
  starDAO?: () => Promise<StarDAO>;
}

class StarService {
  private readonly deps: Required<StarServiceDeps>;

  constructor(
    private readonly env: StarServiceEnv,
    deps: StarServiceDeps = {},
  ) {
    this.deps = {
      starDAO: () => Promise.resolve(new StarDAO(env.DB)),
      ...deps,
    };
  }

  public async star(repoId: string, userEmail: string): Promise<void> {
    const dao = await this.deps.starDAO();
    await dao.star(repoId, userEmail.toLowerCase(), TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async unstar(repoId: string, userEmail: string): Promise<void> {
    const dao = await this.deps.starDAO();
    await dao.unstar(repoId, userEmail.toLowerCase());
  }

  public async isStarred(repoId: string, userEmail: string): Promise<boolean> {
    const dao = await this.deps.starDAO();
    return dao.isStarred(repoId, userEmail.toLowerCase());
  }

  public async countByRepo(repoId: string): Promise<number> {
    const dao = await this.deps.starDAO();
    return dao.countByRepo(repoId);
  }

  public async listRepoIdsByUser(userEmail: string, limit = 200): Promise<string[]> {
    const dao = await this.deps.starDAO();
    return dao.listRepoIdsByUser(userEmail.toLowerCase(), limit);
  }
}

export { StarService };
export type { StarServiceDeps, StarServiceEnv };
