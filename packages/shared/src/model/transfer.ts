import type { TokenScope } from './token';

export interface TokenVolumeGrantMetadata {
  tokenId: string;
  volumeId: string;
  owner: string;
  name: string;
  fullName: string;
  scope: TokenScope;
}

export interface TokenRepoGrantMetadata {
  tokenId: string;
  repositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  scope: TokenScope;
}

export type RepoImportStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface RepoImportMetadata {
  id: string;
  repositoryId: string;
  sourceUrl: string;
  status: RepoImportStatus;
  error: string | null;
  refs: Array<{ ref: string; oid: string }> | null;
  importedRefs: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface RepoMirrorMetadata {
  repositoryId: string;
  sourceUrl: string;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type DeployKeyPermission = 'read' | 'write';

export interface DeployKeyMetadata {
  id: string;
  repositoryId: string;
  name: string;
  tokenPrefix: string | null;
  permission: DeployKeyPermission;
  expiresAt: number;
  lastUsedAt: number | null;
  createdBy: string;
  createdAt: number;
}

export type SecretScanMode = 'off' | 'warn' | 'block';

export interface SecretFinding {
  ruleId: string;
  hint: string;
}

export interface RepoSecuritySettingsMetadata {
  repositoryId: string;
  secretScanMode: SecretScanMode;
  updatedBy: string | null;
  updatedAt: number;
}
