import { AuditLogDAO } from '@duradav/backend-data/dao';
import type { AuditLogFilters, AuditLogRow } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { ForbiddenError } from '@duradav/backend-errors';
import { OrganizationDAO, OrganizationMemberDAO } from '@duradav/backend-data/dao';
import { buildRequestEvent } from './AuditPayloadBuilder';
import type { AuditEvent } from './AuditEventBuilder';
import { AuditObserverRegistry } from './AuditObserver';
import type { AuditObserverFactory } from './AuditObserver';

interface AuditServiceEnv {
  DB: D1Queryable;
}

interface AuditServiceDeps {
  auditLogDAO?: () => Promise<AuditLogDAO>;
  organizationDAO?: () => Promise<OrganizationDAO>;
  organizationMemberDAO?: () => Promise<OrganizationMemberDAO>;
  observers?: AuditObserverRegistry;
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isSafeInteger(limit)) return 50;
  return Math.min(Math.max(limit as number, 1), 200);
}

// Thin facade (AccessBridge AuditService pattern): buildRequestEvent +
// record (fan-out, never throws) + scoped query helpers.
class AuditService {
  private readonly deps: Required<Omit<AuditServiceDeps, 'observers'>> & { observers: AuditObserverRegistry | null };
  private readonly daoFactory: AuditObserverFactory;

  constructor(
    private readonly env: AuditServiceEnv,
    deps: AuditServiceDeps = {},
  ) {
    const auditLogDAO = deps.auditLogDAO ?? (() => Promise.resolve(new AuditLogDAO(env.DB)));
    this.daoFactory = auditLogDAO;
    this.deps = {
      auditLogDAO,
      organizationDAO: deps.organizationDAO ?? (() => Promise.resolve(new OrganizationDAO(env.DB))),
      organizationMemberDAO: deps.organizationMemberDAO ?? (() => Promise.resolve(new OrganizationMemberDAO(env.DB))),
      observers: deps.observers ?? null,
    };
  }

  public static buildRequestEvent(
    request: Request,
    userEmail: string,
    statusCode: number,
    scope?: { orgId?: string | null; repoId?: string | null; resource?: string | null },
  ): AuditEvent {
    return buildRequestEvent(request, userEmail, statusCode, scope);
  }

  private registry(): AuditObserverRegistry {
    return this.deps.observers ?? AuditObserverRegistry.withDefaults(this.daoFactory);
  }

  /**
  Fan-out write; never throws (audit must not fail the request).
  */
  public async record(event: AuditEvent): Promise<void> {
    try {
      await this.registry().notifyAll(event);
    } catch {
      // Observer fan-out already settles per-observer; this is defensive.
    }
  }

  public async query(
    filters: AuditLogFilters,
    limit?: number,
    cursor?: string,
  ): Promise<{ logs: AuditLogRow[]; nextCursor: string | null }> {
    const dao = await this.deps.auditLogDAO();
    return dao.query(filters, clampLimit(limit), cursor);
  }

  /**
  Org-scoped read: org owners only (Edge-Git has no superadmin tier).
  */
  public async queryByOrg(
    orgUsername: string,
    requesterEmail: string,
    filters: Omit<AuditLogFilters, 'orgId' | 'resourcePrefix'>,
    limit?: number,
    cursor?: string,
  ): Promise<{ logs: AuditLogRow[]; nextCursor: string | null }> {
    const orgDAO = await this.deps.organizationDAO();
    const org = await orgDAO.getByUsernameCi(orgUsername.toLowerCase());
    if (!org) {
      // Hide existence like other org gates: unknown orgs report the same
      // owner-only error so membership can't be probed.
      throw new ForbiddenError('Only organization owners can perform this action');
    }
    const memberDAO = await this.deps.organizationMemberDAO();
    const membership = await memberDAO.get(org.id, requesterEmail.toLowerCase());
    if (membership?.role !== 'owner') throw new ForbiddenError('Only organization owners can perform this action');
    const dao = await this.deps.auditLogDAO();
    return dao.queryOrgAudit(org.id, org.username, filters, clampLimit(limit), cursor);
  }

  /**
  Personal trail: callers only ever see their own actions.
  */
  public async queryMine(
    requesterEmail: string,
    filters: Omit<AuditLogFilters, 'userEmail'>,
    limit?: number,
    cursor?: string,
  ): Promise<{ logs: AuditLogRow[]; nextCursor: string | null }> {
    const dao = await this.deps.auditLogDAO();
    return dao.query({ ...filters, userEmail: requesterEmail.toLowerCase() }, clampLimit(limit), cursor);
  }

  public async pruneOlderThan(cutoff: number, limit: number): Promise<number> {
    const dao = await this.deps.auditLogDAO();
    return dao.pruneOlderThan(cutoff, limit).catch(() => 0);
  }
}

export { AuditService };
export type { AuditServiceDeps, AuditServiceEnv };
