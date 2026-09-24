import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';

interface AuditEventInput {
  userEmail: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  resource?: string | null;
  detail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  orgId?: string | null;
  repoId?: string | null;
}

interface AuditEvent extends Required<Pick<AuditEventInput, 'userEmail' | 'action' | 'method' | 'path' | 'statusCode'>> {
  logId: string;
  timestamp: number;
  resource: string | null;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  orgId: string | null;
  repoId: string | null;
}

// Builder (AccessBridge AuditEventBuilder pattern): stamps logId/timestamp,
// throws when a core field is missing so bad events fail fast at build time.
class AuditEventBuilder {
  private input: Partial<AuditEventInput> = {};

  public userEmail(email: string): this {
    this.input.userEmail = email;
    return this;
  }

  public action(action: string): this {
    this.input.action = action;
    return this;
  }

  public request(method: string, path: string): this {
    this.input.method = method;
    this.input.path = path;
    return this;
  }

  public status(statusCode: number): this {
    this.input.statusCode = statusCode;
    return this;
  }

  public resource(resource: string | null | undefined): this {
    this.input.resource = resource ?? null;
    return this;
  }

  public detail(detail: string | null | undefined): this {
    this.input.detail = detail ?? null;
    return this;
  }

  public network(ipAddress: string | null | undefined, userAgent: string | null | undefined): this {
    this.input.ipAddress = ipAddress ?? null;
    this.input.userAgent = userAgent ?? null;
    return this;
  }

  public scope(orgId: string | null | undefined, repoId: string | null | undefined): this {
    this.input.orgId = orgId ?? null;
    this.input.repoId = repoId ?? null;
    return this;
  }

  public build(): AuditEvent {
    const { userEmail, action, method, path, statusCode } = this.input;
    if (!userEmail || !action || !method || !path || statusCode === undefined) {
      throw new Error('Audit event is missing required fields');
    }
    return {
      logId: UUIDUtil.getRandomUUID(),
      timestamp: TimestampUtil.getCurrentUnixTimestampInSeconds(),
      userEmail,
      action,
      method,
      path,
      statusCode,
      resource: this.input.resource ?? null,
      detail: this.input.detail ?? null,
      ipAddress: this.input.ipAddress ?? null,
      userAgent: this.input.userAgent ?? null,
      orgId: this.input.orgId ?? null,
      repoId: this.input.repoId ?? null,
    };
  }
}

export { AuditEventBuilder };
export type { AuditEvent, AuditEventInput };
