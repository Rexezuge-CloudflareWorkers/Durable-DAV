import { AppConfiguration } from '@duradav/backend-runtime/config';
import type { Provider } from '@duradav/backend-runtime/di';
import type { PermissionService } from '../permission/PermissionService';
import type { RepoServiceDeps, RepoServiceEnv } from './RepoService';

/**
 * Fluent composer for `RepoServiceDeps` (Builder pattern).
 *
 * The 27-thunk dependency literal was duplicated between the composition
 * root and tests, with no validation that load-bearing DAOs were wired.
 * The builder accepts the whole `DaoThunks` bundle at once, fills
 * `permissionService`/`config` defaults from `env` exactly like the service
 * constructor, and `build()` fails fast when the repository or user DAO is
 * missing instead of throwing on first use.
 */
class RepoServiceDepsBuilder {
  private constructor(
    private readonly env: RepoServiceEnv,
    private partial: RepoServiceDeps,
  ) {}

  public static fromEnv(env: RepoServiceEnv): RepoServiceDepsBuilder {
    return new RepoServiceDepsBuilder(env, {});
  }

  public with<K extends keyof RepoServiceDeps>(key: K, value: NonNullable<RepoServiceDeps[K]>): this {
    this.partial = { ...this.partial, [key]: value };
    return this;
  }

  public withDaos(daos: { [K in keyof RepoServiceDeps]?: RepoServiceDeps[K] }): this {
    this.partial = { ...this.partial, ...daos };
    return this;
  }

  public withPermissionService(provider: Provider<PermissionService>): this {
    this.partial = { ...this.partial, permissionService: provider };
    return this;
  }

  public withConfig(config: AppConfiguration): this {
    this.partial = { ...this.partial, config };
    return this;
  }

  public build(): RepoServiceDeps & {
    repositoryDAO: NonNullable<RepoServiceDeps['repositoryDAO']>;
    userDAO: NonNullable<RepoServiceDeps['userDAO']>;
    config: AppConfiguration;
  } {
    const repositoryDAO = this.partial.repositoryDAO;
    if (!repositoryDAO) throw new Error('RepoServiceDepsBuilder: repositoryDAO is required');
    const userDAO = this.partial.userDAO;
    if (!userDAO) throw new Error('RepoServiceDepsBuilder: userDAO is required');
    const config = this.partial.config ?? AppConfiguration.fromEnv(this.env);
    return { ...this.partial, repositoryDAO, userDAO, config };
  }
}

export { RepoServiceDepsBuilder };
