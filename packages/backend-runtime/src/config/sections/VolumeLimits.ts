import { EnvParser } from '../EnvParser';
import {
  DEFAULT_DO_DEVICE_BYTES,
  DEFAULT_DEFAULT_CREDENTIAL_EXPIRY_DAYS,
  DEFAULT_MAX_CREDENTIAL_EXPIRY_DAYS,
  DEFAULT_MAX_CREDENTIALS_PER_VOLUME,
  DEFAULT_MAX_VOLUMES_PER_USER,
} from '../ConfigurationDefaults';

// Bucket + credential + Durable Object device limits.
class VolumeLimits {
  constructor(private readonly env: unknown) {}

  public getMaxVolumesPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_VOLUMES_PER_USER', DEFAULT_MAX_VOLUMES_PER_USER);
  }

  public getMaxCredentialsPerVolume(): number {
    return EnvParser.positiveInt(this.env, 'MAX_CREDENTIALS_PER_VOLUME', DEFAULT_MAX_CREDENTIALS_PER_VOLUME);
  }

  public getDefaultCredentialExpiryDays(): number {
    return EnvParser.positiveInt(this.env, 'DEFAULT_CREDENTIAL_EXPIRY_DAYS', DEFAULT_DEFAULT_CREDENTIAL_EXPIRY_DAYS);
  }

  public getMaxCredentialExpiryDays(): number {
    return EnvParser.positiveInt(this.env, 'MAX_CREDENTIAL_EXPIRY_DAYS', DEFAULT_MAX_CREDENTIAL_EXPIRY_DAYS);
  }

  public getDoDeviceBytes(): number {
    return EnvParser.positiveInt(this.env, 'DO_DEVICE_BYTES', DEFAULT_DO_DEVICE_BYTES);
  }
}

export { VolumeLimits };
