import { WatchDAO } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { TimestampUtil } from '@duradav/shared/utils';

interface WatchServiceEnv {
  DB: D1Queryable;
}

interface WatchServiceDeps {
  watchDAO?: () => Promise<WatchDAO>;
}

class WatchService {
  private readonly deps: Required<WatchServiceDeps>;

  constructor(
    private readonly env: WatchServiceEnv,
    deps: WatchServiceDeps = {},
  ) {
    this.deps = {
      watchDAO: () => Promise.resolve(new WatchDAO(env.DB)),
      ...deps,
    };
  }

  public async watch(repoId: string, userEmail: string): Promise<void> {
    const dao = await this.deps.watchDAO();
    await dao.watch(repoId, userEmail.toLowerCase(), TimestampUtil.getCurrentUnixTimestampInSeconds());
  }

  public async unwatch(repoId: string, userEmail: string): Promise<void> {
    const dao = await this.deps.watchDAO();
    await dao.unwatch(repoId, userEmail.toLowerCase());
  }

  public async ensureWatching(repoId: string, userEmail: string): Promise<void> {
    await this.watch(repoId, userEmail);
  }

  public async isWatching(repoId: string, userEmail: string): Promise<boolean> {
    const dao = await this.deps.watchDAO();
    return dao.isWatching(repoId, userEmail.toLowerCase());
  }

  public async countByRepo(repoId: string): Promise<number> {
    const dao = await this.deps.watchDAO();
    return dao.countByRepo(repoId);
  }

  public async listWatchers(repoId: string, limit = 500): Promise<string[]> {
    const dao = await this.deps.watchDAO();
    return dao.listWatchers(repoId, limit);
  }

  public async listRepoIdsByUser(userEmail: string, limit = 200): Promise<string[]> {
    const dao = await this.deps.watchDAO();
    return dao.listRepoIdsByUser(userEmail.toLowerCase(), limit);
  }
}

export { WatchService };
export type { WatchServiceDeps, WatchServiceEnv };
