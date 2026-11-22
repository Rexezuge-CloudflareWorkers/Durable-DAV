import { AppConfiguration } from '@durable-dav/backend-runtime/config';
import { DavCredentialDAO } from '@durable-dav/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { BadRequestError, InternalServerError, NotFoundError } from '@rexezuge/errors';
import type { DavCredentialMetadata } from '@durable-dav/shared/model';
import { TimestampUtil } from '@rexezuge/shared';
import { DavCredentialUtil, NEVER_EXPIRES_AT } from '@durable-dav/shared/utils/DavCredentialUtil';

interface VolumeCredentialServiceEnv {
  DB: D1Queryable;
  MAX_CREDENTIALS_PER_VOLUME?: string;
  DEFAULT_CREDENTIAL_EXPIRY_DAYS?: string;
  MAX_CREDENTIAL_EXPIRY_DAYS?: string;
}

interface VolumeCredentialServiceDeps {
  credentialDAO?: () => Promise<DavCredentialDAO>;
  config?: AppConfiguration;
}

/**
 * How many times to re-roll a colliding generated username.
 *
 * A bound, not a `while (true)`: five consecutive collisions on a
 * `volume-adjective-animal-digits` space with a random component is not
 * something a user should be left retrying against.
 */
const MAX_USERNAME_GENERATION_ATTEMPTS = 5;

class VolumeCredentialService {
  private readonly deps: Required<VolumeCredentialServiceDeps>;

  constructor(env: VolumeCredentialServiceEnv, deps: VolumeCredentialServiceDeps = {}) {
    this.deps = {
      credentialDAO: () => Promise.resolve(new DavCredentialDAO(env.DB)),
      config: AppConfiguration.fromEnv(env),
      ...deps,
    };
  }

  public static async hashPassword(password: string): Promise<string> {
    return DavCredentialUtil.hashPassword(password);
  }

  public async listCredentials(volumeId: string): Promise<DavCredentialMetadata[]> {
    const dao = await this.deps.credentialDAO();
    return dao.listByVolume(volumeId);
  }

  /**
   * Resolve `expiresInDays` from an untrusted body value.
   *
   * Accepts a numeric string as well as a number because the value arrives from
   * parsed JSON, where a client that quoted it is not wrong about intent. The
   * upper bound is the config's, not a constant, so raising
   * `MAX_CREDENTIAL_EXPIRY_DAYS` takes effect without a code change.
   */
  private resolveExpiryDays(expiresInDays: unknown, maxDays: number): number {
    const defaultDays = this.deps.config.getDefaultCredentialExpiryDays();
    if (expiresInDays === undefined || expiresInDays === null) return defaultDays;
    const numeric: unknown =
      typeof expiresInDays === 'string' && /^\d+$/.test(expiresInDays.trim()) ? Number(expiresInDays.trim()) : expiresInDays;
    if (!Number.isSafeInteger(numeric) || (numeric as number) < 1) {
      throw new BadRequestError('expiresInDays must be a positive integer');
    }
    const days = numeric as number;
    if (days > maxDays) throw new BadRequestError(`Credential expiry cannot exceed ${maxDays} days.`);
    return days;
  }

  /**
   * Validate the caller-supplied credential name.
   *
   * Length-checked here rather than by a column constraint so an over-long name
   * is a 400 on the caller's own request instead of a 500 from the INSERT.
   */
  private static resolveName(name: unknown): string {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) throw new BadRequestError('name is required');
    if (trimmed.length > 100) throw new BadRequestError('name must be at most 100 characters');
    return trimmed;
  }

  public async createCredential(
    volumeId: string,
    volumeName: string,
    name: string,
    expiresInDays?: unknown,
    readOnly?: unknown,
    server?: unknown,
  ): Promise<{ password: string; metadata: DavCredentialMetadata }> {
    const dao = await this.deps.credentialDAO();
    const maxCredentials = this.deps.config.getMaxCredentialsPerVolume();
    if ((await dao.countByVolume(volumeId)) >= maxCredentials) {
      throw new BadRequestError(`Maximum ${maxCredentials} credentials allowed per bucket.`);
    }
    const trimmedName = VolumeCredentialService.resolveName(name);
    const readOnlyFlag = VolumeCredentialService.readBooleanFlag('readOnly', readOnly);
    const isServer = VolumeCredentialService.readBooleanFlag('server', server);
    // A server credential deliberately has no expiry, so `expiresInDays` is not
    // resolved at all: an absent value would otherwise fall back to the 365-day
    // default and quietly defeat the whole point of this credential type.
    const expiresAt = isServer
      ? NEVER_EXPIRES_AT
      : TimestampUtil.addDays(
          TimestampUtil.getCurrentUnixTimestampInSeconds(),
          this.resolveExpiryDays(expiresInDays, this.deps.config.getMaxCredentialExpiryDays()),
        );
    const password = DavCredentialUtil.generatePassword();
    const passwordHash = await DavCredentialUtil.hashPassword(password);
    // The generated username has a random component, so a collision is unlikely
    // — but "unlikely" is not "impossible" and usernames are globally unique, so
    // a collision must be retried rather than surfaced to the user. A unique
    // violation from `create` is the same case observed one step later, after a
    // concurrent writer beat the pre-check.
    for (let attempt = 0; attempt < MAX_USERNAME_GENERATION_ATTEMPTS; attempt += 1) {
      const username = DavCredentialUtil.generateUsername(volumeName);
      if (await dao.usernameExists(username)) continue;
      try {
        const metadata = await dao.create(
          volumeId,
          username,
          passwordHash,
          trimmedName,
          DavCredentialUtil.getPrefix(password),
          DavCredentialUtil.getLastFour(password),
          expiresAt,
          readOnlyFlag,
          isServer,
        );
        return { password, metadata };
      } catch (error) {
        if (!VolumeCredentialService.isUniqueConstraintError(error)) throw error;
      }
    }
    throw new InternalServerError('Failed to generate a unique credential username.');
  }

  public async deleteCredential(volumeId: string, credentialId: string): Promise<void> {
    const dao = await this.deps.credentialDAO();
    await dao.deleteForVolume(credentialId, volumeId);
  }

  /**
   * Flip a credential between read-only and full access.
   *
   * Both directions are allowed, and the flag is the only thing that changes:
   * the password, the username, and the expiry are untouched, so this cannot be
   * used to mint or recover a secret. The volume scoping lives in the DAO's
   * `WHERE`, so a credential belonging to another bucket is a silent no-op and
   * the caller reports not-found.
   *
   * The flag gates the *next* request: a client that already holds the
   * credential and has it cached will find its next write refused (or, in the
   * other direction, accepted) with nothing to renegotiate. That is inherent to
   * a bearer secret — the alternative would be re-prompting the password, which
   * is what a 401 would do and is why writes are refused with 403.
   */
  public async setCredentialReadOnly(volumeId: string, credentialId: string, readOnly: unknown): Promise<DavCredentialMetadata> {
    const flag = VolumeCredentialService.readBooleanFlag('readOnly', readOnly);
    const dao = await this.deps.credentialDAO();
    await dao.updateReadOnly(credentialId, volumeId, flag);
    const updated = await dao.getById(credentialId);
    // A row that is gone, expired, or owned by a different bucket lands here.
    // Refuse to invent one: reporting a success for a credential that does not
    // exist is how a caller would conclude the flag was flipped.
    if (!updated || updated.volumeId !== volumeId) throw new NotFoundError('Credential not found.');
    return updated;
  }

  /**
   * Coerce a boolean request field (`readOnly`, `server`) to a flag.
   *
   * Absent means `false` — the credential's historical behaviour, so an
   * existing client posting the old body shape is unaffected. Present but not a
   * boolean is a 400 rather than a silent default: a form that sent `"true"` or
   * `1` meant to restrict writes (or to mint a permanent credential), and
   * quietly granting something else is the one outcome that must not happen by
   * accident. The field name is carried in the error so a client sending two
   * flags can tell which one it got wrong.
   */
  private static readBooleanFlag(field: string, value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value !== 'boolean') throw new BadRequestError(`${field} must be a boolean`);
    return value;
  }

  private static isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error && /unique constraint/i.test(error.message);
  }
}

export { VolumeCredentialService };
export type { VolumeCredentialServiceEnv, VolumeCredentialServiceDeps };
