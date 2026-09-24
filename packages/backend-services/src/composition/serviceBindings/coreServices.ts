// Core identity/governance bindings: auth, users, orgs, teams, audit,
// permissions. Single PermissionService binding lives here (Otter pattern);
// dependent groups resolve it lazily via the container.
import { AccessAuthService, TokenService } from '@duradav/backend-services/auth';
import { AuditObserverRegistry, AuditService } from '@duradav/backend-services/audit';
import { DavPermissionService } from '@duradav/backend-services/dav';
import { VolumeService } from '@duradav/backend-services/dav';
import { DomainEventBus, registerDomainEventDefaults } from '@duradav/backend-services/events';
import { IdentityResolver } from '@duradav/backend-services/identity';
import { OrganizationService } from '@duradav/backend-services/org';
import { PermissionService } from '@duradav/backend-services/permission';
import { TeamService } from '@duradav/backend-services/team';
import { UserService } from '@duradav/backend-services/user';
import { AppConfiguration } from '@duradav/backend-runtime/config';
import type { Container } from '@duradav/backend-runtime/di';
import { Tokens } from '../tokens';
import { createService } from '../serviceFactory';
import type { ServiceGroupContext } from './daoThunks';

function bindCoreServices(scope: Container, { env, daos }: ServiceGroupContext): void {
  scope.bind(Tokens.AccessAuthService, () => createService(AccessAuthService, env));
  scope.bind(Tokens.TokenService, () =>
    createService(TokenService, env, {
      tokenDAO: daos.tokenDAO,
      volumeDAO: daos.davVolumeDAO,
      tokenVolumeGrantDAO: daos.tokenVolumeGrantDAO,
      repositoryDAO: daos.repositoryDAO,
      tokenGrantDAO: daos.tokenGrantDAO,
    }),
  );
  scope.bind(Tokens.UserService, () =>
    createService(UserService, env, {
      userDAO: daos.userDAO,
      namespaceDAO: daos.namespaceDAO,
      organizationDAO: daos.organizationDAO,
      repositoryDAO: daos.repositoryDAO,
      issueDAO: daos.issueDAO,
      pullRequestDAO: daos.pullRequestDAO,
      eventDAO: daos.eventDAO,
      notificationDAO: daos.notificationDAO,
      webhookDAO: daos.webhookDAO,
    }),
  );
  scope.bind(Tokens.OrganizationService, () =>
    createService(OrganizationService, env, {
      organizationDAO: daos.organizationDAO,
      organizationMemberDAO: daos.organizationMemberDAO,
      namespaceDAO: daos.namespaceDAO,
      userDAO: daos.userDAO,
      repositoryDAO: daos.repositoryDAO,
      issueDAO: daos.issueDAO,
      pullRequestDAO: daos.pullRequestDAO,
      eventDAO: daos.eventDAO,
      notificationDAO: daos.notificationDAO,
      webhookDAO: daos.webhookDAO,
    }),
  );
  scope.bind(Tokens.TeamService, () =>
    createService(TeamService, env, {
      teamDAO: daos.teamDAO,
      teamMemberDAO: daos.teamMemberDAO,
      teamGrantDAO: daos.teamGrantDAO,
      organizationDAO: daos.organizationDAO,
      organizationMemberDAO: daos.organizationMemberDAO,
      userDAO: daos.userDAO,
      repositoryDAO: daos.repositoryDAO,
    }),
  );
  scope.bind(Tokens.AuditObserverRegistry, () => AuditObserverRegistry.withDefaults(daos.auditLogDAO));
  scope.bind(Tokens.IdentityResolver, () => createService(IdentityResolver, env, { userDAO: daos.userDAO }));
  scope.bind(Tokens.AuditService, (container) =>
    createService(AuditService, env, {
      auditLogDAO: daos.auditLogDAO,
      organizationDAO: daos.organizationDAO,
      organizationMemberDAO: daos.organizationMemberDAO,
      observers: container.get(Tokens.AuditObserverRegistry),
    }),
  );
  // Mediator for audit/webhook/realtime/check fan-out. Default transport
  // subscribers resolve lazily via the container so routes and middleware
  // publish intent (`bus.emit(...)`) instead of calling services directly.
  scope.bind(Tokens.DomainEventBus, (container) => registerDomainEventDefaults(new DomainEventBus(), container));
  scope.bind(Tokens.PermissionService, () =>
    createService(PermissionService, env, {
      organizationDAO: daos.organizationDAO,
      organizationMemberDAO: daos.organizationMemberDAO,
      repoCollaboratorDAO: daos.repoCollaboratorDAO,
      namespaceDAO: daos.namespaceDAO,
      teamMemberDAO: daos.teamMemberDAO,
      teamGrantDAO: daos.teamGrantDAO,
      teamDAO: daos.teamDAO,
      // Production D1 has every migration: a missing table is deploy skew,
      // not a legacy DB — fail closed instead of degrading to public-read.
      strictSchema: !AppConfiguration.fromEnv(env).isBypassAllowed(),
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
