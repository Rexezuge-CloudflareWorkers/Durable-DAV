import { SecuritySettingsDAO } from '@duradav/backend-data/dao';
import type { SecretScanMode } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError } from '@duradav/backend-errors';
import type { RepoSecuritySettingsMetadata } from '@duradav/shared';
import { TimestampUtil } from '@duradav/shared/utils';

interface SecuritySettingsServiceEnv {
  DB: D1Queryable;
}

interface SecuritySettingsServiceDeps {
  settingsDAO?: () => Promise<SecuritySettingsDAO>;
}

const SCAN_MODES = ['off', 'warn', 'block'] as const;

function normalizeMode(input: unknown): SecretScanMode {
  if (typeof input === 'string' && (SCAN_MODES as readonly string[]).includes(input)) return input as SecretScanMode;
  throw new BadRequestError('secretScanMode must be off, warn, or block');
}

class SecuritySettingsService {
  private readonly deps: Required<SecuritySettingsServiceDeps>;

  constructor(
    private readonly env: SecuritySettingsServiceEnv,
    deps: SecuritySettingsServiceDeps = {},
  ) {
    this.deps = {
      settingsDAO: () => Promise.resolve(new SecuritySettingsDAO(env.DB)),
      ...deps,
    };
  }

  public static normalizeMode(input: unknown): SecretScanMode {
    return normalizeMode(input);
  }

  // Warn-by-default: missing rows (legacy DBs) scan in warn mode so
  // existing pushes keep working while new secrets still surface.
  public async getMode(repositoryId: string): Promise<SecretScanMode> {
    const dao = await this.deps.settingsDAO();
    const row = await dao.getByRepo(repositoryId).catch(() => null);
    return row?.secret_scan_mode ?? 'warn';
  }

  public async getSettings(repositoryId: string): Promise<RepoSecuritySettingsMetadata> {
    const mode = await this.getMode(repositoryId);
    const dao = await this.deps.settingsDAO();
    const row = await dao.getByRepo(repositoryId).catch(() => null);
    return { repositoryId, secretScanMode: mode, updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? 0 };
  }

  public async setMode(repositoryId: string, mode: SecretScanMode, updatedBy: string): Promise<RepoSecuritySettingsMetadata> {
    const dao = await this.deps.settingsDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.setScanMode(repositoryId, mode, updatedBy.toLowerCase(), now);
    return this.getSettings(repositoryId);
  }
}

export { SecuritySettingsService };
export type { SecuritySettingsServiceDeps, SecuritySettingsServiceEnv };
