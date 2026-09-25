// Shared DAO thunk bundle for service bindings.
import type { DavCredentialDAO, DavVolumeDAO, NamespaceDAO, UserDAO } from '@durable-dav/backend-data/dao';
import type { RequestScopeEnv } from '../serviceFactory';

interface DaoThunks {
  userDAO: () => Promise<UserDAO>;
  namespaceDAO: () => Promise<NamespaceDAO>;
  davVolumeDAO: () => Promise<DavVolumeDAO>;
  davCredentialDAO: () => Promise<DavCredentialDAO>;
}

interface ServiceGroupContext {
  env: RequestScopeEnv;
  daos: DaoThunks;
}

export type { DaoThunks, ServiceGroupContext };
