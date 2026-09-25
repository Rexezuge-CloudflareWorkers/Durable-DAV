// Grouped DAO barrels — import from a domain group for readability
// (`@durable-dav/backend-data/dao/identity`), or from the root barrel.
export * from './identity';
export * from './dav';
export { BaseDAO } from './BaseDAO';
export { buildSetClause } from './UpdateClause';
export type { SetAssignment, SetClause } from './UpdateClause';
export type DavRole = 'admin' | 'write' | 'read';
export interface DavCollaboratorRow {
  volume_id: string;
  user_email: string;
  role: DavRole;
  granted_by: string | null;
  created_at: number;
}
