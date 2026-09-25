// Service bindings for the per-request composition root.
import type { DavCredentialDAO, DavVolumeDAO, NamespaceDAO, UserDAO } from '@durable-dav/backend-data/dao';
import type { Container, Token } from '@durable-dav/backend-runtime/di';
import { Tokens } from './tokens';
import type { RequestScopeEnv } from './serviceFactory';
import type { DaoThunks } from './serviceBindings/daoThunks';
import { bindCoreServices } from './serviceBindings/coreServices';

function bindServiceBindings(scope: Container, env: RequestScopeEnv): void {
  const getDao = <T>(token: Token<() => Promise<T>>): (() => Promise<T>) => scope.get(token);

  const daos: DaoThunks = {
    userDAO: getDao<UserDAO>(Tokens.UserDAO),
    namespaceDAO: getDao<NamespaceDAO>(Tokens.NamespaceDAO),
    davVolumeDAO: getDao<DavVolumeDAO>(Tokens.DavVolumeDAO),
    davCredentialDAO: getDao<DavCredentialDAO>(Tokens.DavCredentialDAO),
  };

  bindCoreServices(scope, { env, daos });
}

export { bindServiceBindings };
