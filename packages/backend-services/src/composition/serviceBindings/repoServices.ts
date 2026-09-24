// Repo-domain bindings: repos, forks, branch protection, checks, search,
// realtime, notifications. Services needing authorization resolve the single
// shared PermissionService via the container (never `new`).
import { BranchProtectionService } from '@duradav/backend-services/protection';
import { CheckService } from '@duradav/backend-services/checks';
import { ForkService } from '@duradav/backend-services/fork';
import { NotificationService } from '@duradav/backend-services/social/NotificationService';
import { RealtimeService } from '@duradav/backend-services/realtime';
import { RepoService } from '@duradav/backend-services/repo';
import { RepoServiceDepsBuilder } from '@duradav/backend-services/repo';
import { SearchService } from '@duradav/backend-services/search';
import { AppConfiguration } from '@duradav/backend-runtime/config';
import type { Container } from '@duradav/backend-runtime/di';
import { Tokens } from '../tokens';
import { createService } from '../serviceFactory';
import type { ServiceGroupContext } from './daoThunks';

function bindRepoServices(scope: Container, { env, daos }: ServiceGroupContext): void {
  scope.bind(Tokens.CheckService, () => createService(CheckService, env, { checkRunDAO: daos.checkRunDAO }));
  scope.bind(Tokens.BranchProtectionService, () =>
    createService(BranchProtectionService, env, { branchProtectionDAO: daos.branchProtectionDAO }),
  );
  scope.bind(Tokens.ForkService, (container) =>
    createService(ForkService, env, {
      repositoryDAO: daos.repositoryDAO,
      userDAO: daos.userDAO,
      organizationDAO: daos.organizationDAO,
      organizationMemberDAO: daos.organizationMemberDAO,
      repoCollaboratorDAO: daos.repoCollaboratorDAO,
      namespaceDAO: daos.namespaceDAO,
      permissionService: () => Promise.resolve(container.get(Tokens.PermissionService)),
    }),
  );
  scope.bind(Tokens.RepoService, (container) =>
    createService(
      RepoService,
      env,
      RepoServiceDepsBuilder.fromEnv(env)
        .withDaos({
          repositoryDAO: daos.repositoryDAO,
          issueDAO: daos.issueDAO,
          pullRequestDAO: daos.pullRequestDAO,
          pullThreadDAO: daos.pullThreadDAO,
          branchProtectionDAO: daos.branchProtectionDAO,
          userDAO: daos.userDAO,
          organizationDAO: daos.organizationDAO,
          organizationMemberDAO: daos.organizationMemberDAO,
          repoCollaboratorDAO: daos.repoCollaboratorDAO,
          namespaceDAO: daos.namespaceDAO,
          starDAO: daos.starDAO,
          watchDAO: daos.watchDAO,
          eventDAO: daos.eventDAO,
          notificationDAO: daos.notificationDAO,
          releaseDAO: daos.releaseDAO,
          projectDAO: daos.projectDAO,
          discussionDAO: daos.discussionDAO,
          wikiDAO: daos.wikiDAO,
          importDAO: daos.importDAO,
          mirrorDAO: daos.mirrorDAO,
          deployKeyDAO: daos.deployKeyDAO,
          deletedRepoDoDAO: daos.deletedRepoDoDAO,
          numberingDAO: daos.numberingDAO,
          searchDAO: daos.searchDAO,
          tokenGrantDAO: daos.tokenGrantDAO,
          securitySettingsDAO: daos.securitySettingsDAO,
          collaborationDAO: daos.collaborationDAO,
          webhookDAO: daos.webhookDAO,
          webhookDeliveryDAO: daos.webhookDeliveryDAO,
          auditLogDAO: daos.auditLogDAO,
          teamGrantDAO: daos.teamGrantDAO,
          checkRunDAO: daos.checkRunDAO,
        })
        .withPermissionService(() => Promise.resolve(container.get(Tokens.PermissionService)))
        .withConfig(AppConfiguration.fromEnv(env))
        .build(),
    ),
  );
  scope.bind(Tokens.SearchService, (container) =>
    createService(SearchService, env, {
      searchDAO: daos.searchDAO,
      repositoryDAO: daos.repositoryDAO,
      issueDAO: daos.issueDAO,
      permissionService: () => Promise.resolve(container.get(Tokens.PermissionService)),
    }),
  );
  scope.bind(Tokens.RealtimeService, (container) =>
    createService(RealtimeService, env, {
      repositoryDAO: daos.repositoryDAO,
      permissionService: () => Promise.resolve(container.get(Tokens.PermissionService)),
    }),
  );
  scope.bind(Tokens.NotificationService, (container) =>
    createService(NotificationService, env, {
      notificationDAO: daos.notificationDAO,
      watchDAO: daos.watchDAO,
      userDAO: daos.userDAO,
      repositoryDAO: daos.repositoryDAO,
      permissionService: () => Promise.resolve(container.get(Tokens.PermissionService)),
    }),
  );
}

export { bindRepoServices };
