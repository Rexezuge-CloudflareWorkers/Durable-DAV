import type { Container } from '@duradav/backend-runtime/di';
import { INBOX_SHARD, isChannel, repoShardFor } from '@duradav/shared/realtime';
import { Tokens } from '../composition/tokens';
import { RealtimeService } from '../realtime/RealtimeService';
import { DomainEventBus } from './DomainEventBus';
import type { CheckUpdatedInput, RealtimePublishInput, WebhookEmitEventInput } from './DomainEvents';
import type { AuditEvent } from '../audit/AuditEventBuilder';

const CHECK_SHA_RE = /^[0-9a-f]{4,64}$/i;

/**
 * Default transport subscribers (Mediator wiring).
 *
 * Each handler mirrors the best-effort contract of the `SocialEmit`
 * functions it replaces: resolve best-effort, degrade silently, never
 * throw (the bus additionally settles all handlers). Registered once per
 * request scope via `registerDomainEventDefaults` (bound as
 * `Tokens.DomainEventBus`); `apps/api` emitters supply only data plus the
 * `IRealtimePublisher` port.
 */
async function handleAuditRecord(container: Container, event: AuditEvent): Promise<void> {
  await container.get(Tokens.AuditService).record(event);
}

async function handleWebhookEmit(container: Container, input: WebhookEmitEventInput): Promise<void> {
  let actorUsername = 'ghost';
  try {
    actorUsername = await container.get(Tokens.IdentityResolver).resolveUsername(input.actorEmail);
  } catch {
    actorUsername = 'ghost';
  }
  await container.get(Tokens.WebhookDeliveryService).enqueueForEvent({
    repositoryId: input.repositoryId,
    fullName: input.fullName,
    event: input.event,
    actorUsername,
    eventId: input.eventId,
    subjectType: input.subjectType,
    subjectNumber: input.subjectNumber,
    subjectOid: input.subjectOid,
    title: input.title,
    action: input.action,
    extra: input.extra,
  });
}

async function handleRealtimePublish(
  container: Container,
  input: RealtimePublishInput,
  publishToShard: (shard: string, message: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  if (!container.get(Tokens.AppConfig).isRealtimeEnabled()) return;
  if (!isChannel(input.channel)) return;
  await publishToShard(repoShardFor(input.fullName), {
    channel: input.channel,
    type: input.type,
    actor: input.actorEmail,
    title: input.title,
    subjectType: input.subjectType ?? null,
    subjectNumber: input.subjectNumber ?? null,
    sha: input.subjectOid ?? null,
    extra: input.extra ?? {},
  }).catch(() => undefined);
  const recipients = input.recipientEmails ?? [];
  if (recipients.length === 0) return;
  const hashes = await RealtimeService.hashRecipients(recipients).catch(() => [] as string[]);
  if (hashes.length === 0) return;
  await publishToShard(INBOX_SHARD, {
    channel: `inbox:${hashes[0]}`,
    type: input.type,
    actor: input.actorEmail,
    title: input.title,
    subjectType: input.subjectType ?? null,
    subjectNumber: input.subjectNumber ?? null,
    sha: input.subjectOid ?? null,
    extra: { ...input.extra, fullName: input.fullName },
    recipientHashes: hashes,
  }).catch(() => undefined);
}

async function handleCheckUpdated(
  container: Container,
  input: CheckUpdatedInput,
  publishToShard: (shard: string, message: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  if (!container.get(Tokens.AppConfig).isRealtimeEnabled()) return;
  if (!CHECK_SHA_RE.test(input.headSha)) return;
  const channel = `checks:${input.headSha.toLowerCase()}`;
  if (!isChannel(channel)) return;
  await publishToShard(repoShardFor(input.fullName), {
    channel,
    type: 'check_run.updated',
    actor: input.actorEmail,
    title: input.title ?? `${input.context}: ${input.conclusion ?? input.status}`,
    sha: input.headSha.toLowerCase(),
    extra: { check_run_id: input.checkId ?? null, context: input.context, status: input.status, conclusion: input.conclusion ?? null },
  }).catch(() => undefined);
}

function registerDomainEventDefaults(bus: DomainEventBus, container: Container): DomainEventBus {
  bus.on('audit.record', (event) => handleAuditRecord(container, event.event));
  bus.on('webhook.emit', (event) => handleWebhookEmit(container, event.input));
  bus.on('realtime.publish', (event) => {
    const via = event.via;
    return handleRealtimePublish(container, event.input, (shard, message) => via.publishToShard(shard, message));
  });
  bus.on('check.updated', (event) => {
    const via = event.via;
    return handleCheckUpdated(container, event.input, (shard, message) => via.publishToShard(shard, message));
  });
  return bus;
}

export { registerDomainEventDefaults, handleAuditRecord, handleWebhookEmit, handleRealtimePublish, handleCheckUpdated, CHECK_SHA_RE };
