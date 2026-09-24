export type WebhookEventName =
  | 'push'
  | 'repository'
  | 'issues'
  | 'issue_comment'
  | 'pull_request'
  | 'pull_request_review'
  | 'fork'
  | 'star'
  | 'watch'
  | 'release'
  | 'project'
  | 'discussion'
  | 'discussion_comment'
  | 'wiki'
  | 'snippet'
  | 'check_run'
  | 'check_suite'
  | 'ping';

export interface RepoWebhookMetadata {
  id: string;
  repositoryId: string;
  fullName: string;
  urlMasked: string;
  hasSecret: boolean;
  secretSuffix: string;
  events: WebhookEventName[];
  isActive: boolean;
  consecutiveFailures: number;
  lastDeliveryAt: number | null;
  lastDeliveryStatus: 'success' | 'failure' | null;
  creator: string;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookDeliveryMetadata {
  id: string;
  hookId: string;
  repositoryId: string;
  event: string;
  eventId: string | null;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  nextRetryAt: number;
  lastHttpStatus: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}
