// Content/collaboration bindings: issues, pulls, threads, collab surfaces,
// releases, projects, wiki, snippets, social, webhooks, transfer, keys.
import { CollaborationService } from '@duradav/backend-services/collab';
import { DeployKeyService } from '@duradav/backend-services/deploykey';
import { DiscussionService } from '@duradav/backend-services/discussion';
import { IssueService } from '@duradav/backend-services/issue';
import { ProjectService } from '@duradav/backend-services/project';
import { PullRequestService } from '@duradav/backend-services/pull';
import { PullThreadService } from '@duradav/backend-services/pull/PullThreadService';
import { ReleaseService } from '@duradav/backend-services/release';
import { SecuritySettingsService } from '@duradav/backend-services/security';
import { ActivityService } from '@duradav/backend-services/social/ActivityService';
import { StarService } from '@duradav/backend-services/social/StarService';
import { WatchService } from '@duradav/backend-services/social/WatchService';
import { SnippetService } from '@duradav/backend-services/snippet';
import { WebhookDeliveryService } from '@duradav/backend-services/webhook/WebhookDeliveryService';
import { WebhookService } from '@duradav/backend-services/webhook/WebhookService';
import { WikiService } from '@duradav/backend-services/wiki';
import { AppConfiguration } from '@duradav/backend-runtime/config';
import type { Container } from '@duradav/backend-runtime/di';
import { Tokens } from '../tokens';
import { createService } from '../serviceFactory';
import type { ServiceGroupContext } from './daoThunks';

function bindContentServices(scope: Container, { env, daos }: ServiceGroupContext): void {
  scope.bind(Tokens.IssueService, () => createService(IssueService, env, { issueDAO: daos.issueDAO, numberingDAO: daos.numberingDAO }));
  scope.bind(Tokens.PullRequestService, () =>
    createService(PullRequestService, env, { pullRequestDAO: daos.pullRequestDAO, numberingDAO: daos.numberingDAO }),
  );
  scope.bind(Tokens.PullThreadService, () =>
    createService(PullThreadService, env, { pullRequestDAO: daos.pullRequestDAO, pullThreadDAO: daos.pullThreadDAO }),
  );
  scope.bind(Tokens.StarService, () => createService(StarService, env, { starDAO: daos.starDAO }));
  scope.bind(Tokens.WatchService, () => createService(WatchService, env, { watchDAO: daos.watchDAO }));
  scope.bind(Tokens.ActivityService, () => createService(ActivityService, env, { eventDAO: daos.eventDAO }));
  scope.bind(Tokens.CollaborationService, () => createService(CollaborationService, env, { collaborationDAO: daos.collaborationDAO }));
  scope.bind(Tokens.ReleaseService, () => createService(ReleaseService, env, { releaseDAO: daos.releaseDAO }));
  scope.bind(Tokens.ProjectService, () =>
    createService(ProjectService, env, { projectDAO: daos.projectDAO, numberingDAO: daos.numberingDAO }),
  );
  scope.bind(Tokens.DiscussionService, () =>
    createService(DiscussionService, env, { discussionDAO: daos.discussionDAO, numberingDAO: daos.numberingDAO }),
  );
  scope.bind(Tokens.WikiService, () => createService(WikiService, env, { wikiDAO: daos.wikiDAO }));
  scope.bind(Tokens.SnippetService, () => createService(SnippetService, env, { snippetDAO: daos.snippetDAO }));
  scope.bind(Tokens.DeployKeyService, () => createService(DeployKeyService, env, { deployKeyDAO: daos.deployKeyDAO }));
  scope.bind(Tokens.SecuritySettingsService, () => createService(SecuritySettingsService, env, { settingsDAO: daos.securitySettingsDAO }));
  scope.bind(Tokens.WebhookService, () => createService(WebhookService, env, { webhookDAO: daos.webhookDAO, userDAO: daos.userDAO }));
  scope.bind(Tokens.WebhookDeliveryService, () =>
    createService(WebhookDeliveryService, env, { webhookDAO: daos.webhookDAO, deliveryDAO: daos.webhookDeliveryDAO }),
  );
  // Lazy bind so unit tests mocking `@duradav/backend-runtime/config` with
  // only `ConfigurationManager` keep working; the factory only touches the
  // mocked module when the token is actually resolved.
  scope.bind(Tokens.AppConfig, () => AppConfiguration.fromEnv(env));
}

export { bindContentServices };
