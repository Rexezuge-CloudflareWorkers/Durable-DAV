import type { WebhookEventName } from '@duradav/shared';
import type { AuditEvent } from '../audit/AuditEventBuilder';
import type { IRealtimePublisher } from '../ports/IRealtimePublisher';

/**
 * Domain event envelope (Mediator pattern).
 *
 * Routes and middleware publish *intent* (`audit.record`,
 * `webhook.emit`, `realtime.publish`, `check.updated`) instead of calling
 * `AuditService` / `WebhookDeliveryService` / DO stubs directly. Default
 * transport subscribers are registered in `registerDomainEventDefaults`;
 * realtime delivery crosses the `apps/api` layer boundary via the injected
 * `IRealtimePublisher` port (never a direct stub import).
 */
type DomainEvent =
  | { type: 'audit.record'; event: AuditEvent }
  | { type: 'webhook.emit'; input: WebhookEmitEventInput }
  | { type: 'realtime.publish'; input: RealtimePublishInput; via: IRealtimePublisher }
  | { type: 'check.updated'; input: CheckUpdatedInput; via: IRealtimePublisher };

interface WebhookEmitEventInput {
  repositoryId: string;
  fullName: string;
  actorEmail: string;
  event: WebhookEventName;
  eventId?: string | null;
  subjectType?: string | null;
  subjectNumber?: number | null;
  subjectOid?: string | null;
  title?: string | null;
  action?: string | null;
  extra?: Record<string, unknown>;
}

interface RealtimePublishInput {
  fullName: string;
  channel: string;
  type: string;
  actorEmail: string;
  title: string;
  subjectType?: string | null;
  subjectNumber?: number | null;
  subjectOid?: string | null;
  extra?: Record<string, unknown>;
  recipientEmails?: string[];
}

interface CheckUpdatedInput {
  fullName: string;
  headSha: string;
  context: string;
  status: string;
  conclusion?: string | null;
  actorEmail: string;
  checkId?: string;
  title?: string;
}

type DomainEventType = DomainEvent['type'];

export type { DomainEvent, DomainEventType, WebhookEmitEventInput, RealtimePublishInput, CheckUpdatedInput };
