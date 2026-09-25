// Shared DAO thunk bundle for service bindings.
import type {
  DavCollaboratorDAO,
  DavVolumeDAO,
  NamespaceDAO,
  TokenVolumeGrantDAO,
  UserAccessTokenDAO,
  UserDAO,
} from '@durable-dav/backend-data/dao';
import type { RequestScopeEnv } from '../serviceFactory';

interface DaoThunks {
  userDAO: () => Promise<UserDAO>;
  tokenDAO: () => Promise<UserAccessTokenDAO>;
  namespaceDAO: () => Promise<NamespaceDAO>;
  tokenVolumeGrantDAO: () => Promise<TokenVolumeGrantDAO>;
  davVolumeDAO: () => Promise<DavVolumeDAO>;
  davCollaboratorDAO: () => Promise<DavCollaboratorDAO>;
}

interface ServiceGroupContext {
  env: RequestScopeEnv;
  daos: DaoThunks;
}

export type { DaoThunks, ServiceGroupContext };
