import { UserDAO, WebhookDAO } from '@duradav/backend-data/dao';
import type { RepoWebhookRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { BadRequestError, NotFoundError } from '@duradav/backend-errors';
import { ConfigurationManager } from '@duradav/backend-runtime/config';
import type { RepoWebhookMetadata, WebhookEventName } from '@duradav/shared';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';
import { GHOST_USERNAME } from '../identity/IdentityResolver';
import { generateHookSecret, maskUrl, normalizeEvents, secretSuffix, validateWebhookUrl } from './WebhookEvents';

interface WebhookServiceEnv {
  DB: D1Queryable;
  MAX_HOOKS_PER_REPO?: string;
  ENVIRONMENT?: string;
}

interface WebhookServiceDeps {
  webhookDAO?: () => Promise<WebhookDAO>;
  userDAO?: () => Promise<UserDAO>;
}

function requireProductionHttps(env: WebhookServiceEnv, url: string): void {
  // BREAKING: production webhooks require https so HMAC secrets never ride
  // cleartext. Non-production keeps http for local dev.
  if ((env.ENVIRONMENT ?? '').toLowerCase() === 'production' && url.toLowerCase().startsWith('http://')) {
    throw new BadRequestError('Webhook url must use https in production');
  }
}

const MIN_CUSTOM_SECRET_LENGTH = 16;
const MAX_SECRET_LENGTH = 256;

function toDeliveryStatus(raw: string | null): 'success' | 'failure' | null {
  switch (raw) {
    case 'success': {
      return 'success';
    }
    case 'failure': {
      return 'failure';
    }
    default: {
      return null;
    }
  }
}

function toPublic(row: RepoWebhookRow, events: WebhookEventName[]): RepoWebhookMetadata {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    fullName: row.full_name,
    urlMasked: maskUrl(row.url),
    hasSecret: row.secret.length > 0,
    secretSuffix: row.secret_suffix,
    events,
    isActive: row.is_active === 1,
    consecutiveFailures: row.consecutive_failures,
    lastDeliveryAt: row.last_delivery_at,
    lastDeliveryStatus: toDeliveryStatus(row.last_delivery_status),
    // Sync fallback keeps the `creator` key (never `creatorEmail`) when no
    // DB resolution is available. Instance methods prefer
    // `resolveCreator` → username/ghost below.
    creator: row.creator_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveCreator(getUserDAO: () => Promise<UserDAO>, creatorEmail: string): Promise<string> {
  try {
    const userDAO = await getUserDAO();
    const user = await userDAO.getByEmail(creatorEmail);
    return user?.username ?? GHOST_USERNAME;
  } catch {
    return GHOST_USERNAME;
  }
}

async function resolveEvents(dao: WebhookDAO, hookId: string): Promise<WebhookEventName[]> {
  // Events live only in the junction table. The `typeof` guard keeps minimal
  // test fakes (objects without the new method) on an empty set.
  try {
    if (typeof dao.listEvents !== 'function') return [];
    return normalizeEvents(await dao.listEvents(hookId));
  } catch {
    return [];
  }
}

function normalizeSecret(input: unknown): string {
  if (input === undefined || input === null) return generateHookSecret();
  if (input === '') return generateHookSecret();
  if (typeof input !== 'string' || input.length < MIN_CUSTOM_SECRET_LENGTH || input.length > MAX_SECRET_LENGTH) {
    throw new BadRequestError(`secret must be ${MIN_CUSTOM_SECRET_LENGTH}-${MAX_SECRET_LENGTH} characters (omit to auto-generate)`);
  }
  return input;
}

class WebhookService {
  private readonly deps: Required<WebhookServiceDeps>;

  constructor(
    private readonly env: WebhookServiceEnv,
    deps: WebhookServiceDeps = {},
  ) {
    this.deps = {
      // Encrypted DAOs require a key: outside the request scope (which wires
      // per-feature keys via daoBindings) callers must inject the DAO.
      webhookDAO: () => Promise.reject<WebhookDAO>(new Error('WebhookService requires an injected webhookDAO outside request scope.')),
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      ...deps,
    };
  }

  public static toPublic(row: RepoWebhookRow, events: WebhookEventName[]): RepoWebhookMetadata {
    return toPublic(row, events);
  }

  private async toPublicResolved(row: RepoWebhookRow): Promise<RepoWebhookMetadata> {
    const events = await resolveEvents(await this.deps.webhookDAO(), row.id);
    const base = toPublic(row, events);
    base.creator = await resolveCreator(this.deps.userDAO, row.creator_email);
    return base;
  }

  public async listHooks(repositoryId: string): Promise<RepoWebhookMetadata[]> {
    const dao = await this.deps.webhookDAO();
    const rows = await dao.listByRepo(repositoryId);
    // Perf: concurrent enrichment (was sequential N+1: 10 hooks -> 20 queries).
    // Fail-closed display is preserved: toPublicResolved throws propagate.
    return Promise.all(rows.map((row) => this.toPublicResolved(row)));
  }

  public async getHook(hookId: string, repositoryId: string): Promise<RepoWebhookMetadata> {
    const dao = await this.deps.webhookDAO();
    const row = await dao.getByIdAndRepo(hookId, repositoryId).catch(() => null);
    if (!row) throw new NotFoundError('Webhook not found.');
    return this.toPublicResolved(row);
  }

  public async createHook(input: {
    repositoryId: string;
    fullName: string;
    url: string;
    events?: unknown;
    secret?: unknown;
    creatorEmail: string;
  }): Promise<{ hook: RepoWebhookMetadata; secret: string }> {
    const url = input.url?.trim() ?? '';
    try {
      validateWebhookUrl(url);
      requireProductionHttps(this.env, url);
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : 'Invalid webhook URL.');
    }
    let events: WebhookEventName[];
    try {
      events = normalizeEvents(input.events ?? ['push']);
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : 'Invalid webhook events.');
    }
    const secret = normalizeSecret(input.secret);
    const dao = await this.deps.webhookDAO();
    const max = ConfigurationManager.webhooks.getMaxPerRepo(this.env);
    // Fail-closed: count failures must not bypass MAX_HOOKS_PER_REPO.
    let count: number;
    try {
      count = await dao.countByRepo(input.repositoryId);
    } catch {
      throw new BadRequestError('Webhook service temporarily unavailable');
    }
    if (count >= max) throw new BadRequestError(`Maximum ${max} webhooks per repository`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.create({
      id,
      repositoryId: input.repositoryId,
      url,
      urlPrefix: url.slice(0, 30),
      secret,
      secretSuffix: secretSuffix(secret),
      events,
      creatorEmail: input.creatorEmail.toLowerCase(),
      now,
    });
    const hook: RepoWebhookMetadata = {
      id,
      repositoryId: input.repositoryId,
      fullName: input.fullName,
      urlMasked: maskUrl(url),
      hasSecret: true,
      secretSuffix: secretSuffix(secret),
      events,
      isActive: true,
      consecutiveFailures: 0,
      lastDeliveryAt: null,
      lastDeliveryStatus: null,
      creator: await resolveCreator(this.deps.userDAO, input.creatorEmail.toLowerCase()),
      createdAt: now,
      updatedAt: now,
    };
    return { hook, secret };
  }

  public async updateHook(
    hookId: string,
    repositoryId: string,
    patch: { url?: string; events?: unknown; isActive?: boolean },
  ): Promise<RepoWebhookMetadata> {
    const dao = await this.deps.webhookDAO();
    const row = await dao.getByIdAndRepo(hookId, repositoryId).catch(() => null);
    if (!row) throw new NotFoundError('Webhook not found.');
    let url: string | undefined;
    let urlPrefix: string | undefined;
    if (patch.url !== undefined) {
      url = patch.url.trim();
      try {
        validateWebhookUrl(url);
        requireProductionHttps(this.env, url);
      } catch (error) {
        throw new BadRequestError(error instanceof Error ? error.message : 'Invalid webhook URL.');
      }
      urlPrefix = url.slice(0, 30);
    }
    let events: WebhookEventName[] | undefined;
    if (patch.events !== undefined) {
      try {
        events = normalizeEvents(patch.events);
      } catch (error) {
        throw new BadRequestError(error instanceof Error ? error.message : 'Invalid webhook events.');
      }
    }
    if (patch.isActive !== undefined && typeof patch.isActive !== 'boolean') {
      throw new BadRequestError('isActive must be a boolean');
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.update(hookId, repositoryId, { url, urlPrefix, events, isActive: patch.isActive, now });
    const updated = await dao.getByIdAndRepo(hookId, repositoryId);
    if (!updated) throw new NotFoundError('Webhook not found.');
    return this.toPublicResolved(updated);
  }

  public async rotateHookSecret(hookId: string, repositoryId: string): Promise<{ hook: RepoWebhookMetadata; secret: string }> {
    const dao = await this.deps.webhookDAO();
    const row = await dao.getByIdAndRepo(hookId, repositoryId).catch(() => null);
    if (!row) throw new NotFoundError('Webhook not found.');
    // Fresh unique secret per rotation — never reused, never derived from a
    // shared platform key.
    const secret = generateHookSecret();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.rotateSecret(hookId, repositoryId, secret, secretSuffix(secret), now);
    const updated = await dao.getByIdAndRepo(hookId, repositoryId);
    if (!updated) throw new NotFoundError('Webhook not found.');
    return { hook: await this.toPublicResolved(updated), secret };
  }

  public async deleteHook(hookId: string, repositoryId: string): Promise<void> {
    const dao = await this.deps.webhookDAO();
    const row = await dao.getByIdAndRepo(hookId, repositoryId).catch(() => null);
    if (!row) throw new NotFoundError('Webhook not found.');
    await dao.deleteById(hookId, repositoryId);
  }
}

export { WebhookService };
export type { WebhookServiceDeps, WebhookServiceEnv };
