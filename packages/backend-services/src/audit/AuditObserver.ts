import { AuditLogDAO } from '@duradav/backend-data/dao';
import type { AuditEvent } from './AuditEventBuilder';

interface AuditObserver {
  notify(event: AuditEvent): Promise<void>;
}

type AuditObserverFactory = () => Promise<AuditLogDAO>;

// Durable observer: writes the event to D1. Extra sinks (webhook/SIEM) can
// implement AuditObserver without touching call sites.
class AuditLogObserver implements AuditObserver {
  constructor(private readonly daoFactory: AuditObserverFactory) {}

  public async notify(event: AuditEvent): Promise<void> {
    const dao = await this.daoFactory();
    await dao.create({
      logId: event.logId,
      timestamp: event.timestamp,
      userEmail: event.userEmail,
      action: event.action,
      resource: event.resource,
      method: event.method,
      path: event.path,
      statusCode: event.statusCode,
      detail: event.detail,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      orgId: event.orgId,
      repoId: event.repoId,
    });
  }
}

// Injectable registry (AccessBridge AuditObserverRegistry pattern):
// `withDefaults` for production, `withObservers` for tests.
class AuditObserverRegistry {
  private constructor(private readonly observers: AuditObserver[]) {}

  public static withDefaults(daoFactory: AuditObserverFactory): AuditObserverRegistry {
    return new AuditObserverRegistry([new AuditLogObserver(daoFactory)]);
  }

  public static withObservers(observers: AuditObserver[]): AuditObserverRegistry {
    return new AuditObserverRegistry([...observers]);
  }

  public async notifyAll(event: AuditEvent): Promise<void> {
    await Promise.allSettled(this.observers.map((o) => o.notify(event)));
  }
}

export { AuditLogObserver, AuditObserverRegistry };
export type { AuditObserver, AuditObserverFactory };
