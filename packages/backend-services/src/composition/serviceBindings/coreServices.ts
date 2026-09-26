// Identity/governance bindings: auth, users, volumes, permissions.
// Single DavPermissionService binding lives here; dependents resolve it via
// the container, never `new`.
import { AccessAuthService } from '@durable-dav/backend-services/auth';
import { DavPermissionService } from '@durable-dav/backend-services/dav';
import { VolumeService } from '@durable-dav/backend-services/dav';
import { VolumeCredentialService } from '@durable-dav/backend-services/dav';
import { UserService } from '@durable-dav/backend-services/user';
import { AppConfiguration } from '@durable-dav/backend-runtime/config';
import type { Container } from '@durable-dav/backend-runtime/di';
import { Tokens } from '../tokens';
import { createService } from '../serviceFactory';
import type { ServiceGroupContext } from './daoThunks';

function bindCoreServices(scope: Container, { env, daos }: ServiceGroupContext): void {
  scope.bind(Tokens.AppConfig, () => AppConfiguration.fromEnv(env));
  scope.bind(Tokens.AccessAuthService, () => createService(AccessAuthService, env));
  scope.bind(Tokens.UserService, () =>
    createService(UserService, env, {
      userDAO: daos.userDAO,
      namespaceDAO: daos.namespaceDAO,
      volumeDAO: daos.davVolumeDAO,
    }),
  );
  scope.bind(Tokens.DavPermissionService, () => createService(DavPermissionService, env, {}));
  scope.bind(Tokens.VolumeService, () =>
    createService(VolumeService, env, {
      volumeDAO: daos.davVolumeDAO,
      userDAO: daos.userDAO,
      credentialDAO: daos.davCredentialDAO,
    }),
  );
  scope.bind(Tokens.VolumeCredentialService, () =>
    createService(VolumeCredentialService, env, {
      credentialDAO: daos.davCredentialDAO,
    }),
  );
}

export { bindCoreServices };
