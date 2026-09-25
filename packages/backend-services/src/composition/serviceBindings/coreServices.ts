// Identity/governance bindings: auth, users, volumes, permissions.
// Single DavPermissionService binding lives here; dependents resolve it via
// the container, never `new`.
import { AccessAuthService, TokenService } from '@durable-dav/backend-services/auth';
import { DavPermissionService } from '@durable-dav/backend-services/dav';
import { VolumeService } from '@durable-dav/backend-services/dav';
import { UserService } from '@durable-dav/backend-services/user';
import { AppConfiguration } from '@durable-dav/backend-runtime/config';
import type { Container } from '@durable-dav/backend-runtime/di';
import { Tokens } from '../tokens';
import { createService } from '../serviceFactory';
import type { ServiceGroupContext } from './daoThunks';

function bindCoreServices(scope: Container, { env, daos }: ServiceGroupContext): void {
  scope.bind(Tokens.AppConfig, () => AppConfiguration.fromEnv(env));
  scope.bind(Tokens.AccessAuthService, () => createService(AccessAuthService, env));
  scope.bind(Tokens.TokenService, () =>
    createService(TokenService, env, {
      tokenDAO: daos.tokenDAO,
      volumeDAO: daos.davVolumeDAO,
      tokenVolumeGrantDAO: daos.tokenVolumeGrantDAO,
    }),
  );
  scope.bind(Tokens.UserService, () =>
    createService(UserService, env, {
      userDAO: daos.userDAO,
      namespaceDAO: daos.namespaceDAO,
    }),
  );
  scope.bind(Tokens.DavPermissionService, () =>
    createService(DavPermissionService, env, {
      davCollaboratorDAO: daos.davCollaboratorDAO,
      strictSchema: !AppConfiguration.fromEnv(env).isBypassAllowed(),
    }),
  );
  scope.bind(Tokens.VolumeService, () =>
    createService(VolumeService, env, {
      volumeDAO: daos.davVolumeDAO,
      userDAO: daos.userDAO,
      davCollaboratorDAO: daos.davCollaboratorDAO,
      tokenVolumeGrantDAO: daos.tokenVolumeGrantDAO,
    }),
  );
}

export { bindCoreServices };
