import { EventDAO } from '@duradav/backend-data/dao';
import type { RepoEventRow, RepoEventType } from '@duradav/backend-data/dao';
import type { D1Queryable } from '@duradav/backend-data/utils';
import { TimestampUtil, UUIDUtil } from '@duradav/shared/utils';

interface ActivityServiceEnv {
  DB: D1Queryable;
}

interface ActivityServiceDeps {
  eventDAO?: () => Promise<EventDAO>;
}

interface RecordEventInput {
  repositoryId: string;
  fullName: string;
  actorEmail: string;
  type: RepoEventType;
  subjectType?: string | null;
  subjectNumber?: number | null;
  subjectOid?: string | null;
  payload?: Record<string, unknown> | string;
}

class ActivityService {
  private readonly deps: Required<ActivityServiceDeps>;

  constructor(
    private readonly env: ActivityServiceEnv,
    deps: ActivityServiceDeps = {},
  ) {
    this.deps = {
      eventDAO: () => Promise.resolve(new EventDAO(env.DB)),
      ...deps,
    };
  }

  public async record(input: RecordEventInput): Promise<{ id: string }> {
    const dao = await this.deps.eventDAO();
    const id = UUIDUtil.getRandomUUID();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const payload = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload ?? {});
    await dao.append({
      id,
      repositoryId: input.repositoryId,
      actorEmail: input.actorEmail.toLowerCase(),
      type: input.type,
      subjectType: input.subjectType ?? null,
      subjectNumber: input.subjectNumber ?? null,
      subjectOid: input.subjectOid ?? null,
      payload,
      now,
    });
    return { id };
  }

  public async listByRepo(
    repositoryId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{ events: RepoEventRow[]; nextCursor: string | null }> {
    const dao = await this.deps.eventDAO();
    return dao.listByRepo(repositoryId, Math.min(Math.max(limit, 1), 100), cursor);
  }
}

export { ActivityService };
export type { ActivityServiceDeps, ActivityServiceEnv, RecordEventInput };
