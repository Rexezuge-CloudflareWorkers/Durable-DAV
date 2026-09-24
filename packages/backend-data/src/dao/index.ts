// Grouped DAO barrels — import from a domain group for readability
// (`@duradav/backend-data/dao/identity`), or from the root barrel for
// backward compatibility. Files stay flat to keep relative imports stable;
// grouping lives at the barrel level.
export * from './identity';
export * from './repo';
export * from './dav';
export * from './social';
export * from './collab';
export * from './ops';
export { BaseDAO } from './BaseDAO';
export { buildSetClause } from './UpdateClause';
export type { SetAssignment, SetClause } from './UpdateClause';
export type { TeamMemberRow, TeamMemberRole } from './TeamMemberDAO';
export type { TeamRepoGrantRow } from './TeamRepoGrantDAO';
export type { AuditLogRow, AuditLogFilters } from './AuditLogDAO';
export type { ImportStatus, RepoImportRow } from './ImportDAO';
export type { RepoMirrorRow } from './MirrorDAO';
export type { DeployKeyPermission, DeployKeyRow } from './DeployKeyDAO';
export type { TokenRepoGrantRow } from './TokenRepoGrantDAO';
export type { SecretScanMode, SecuritySettingsRow } from './SecuritySettingsDAO';
export type { CheckRunRow } from './CheckRunDAO';
