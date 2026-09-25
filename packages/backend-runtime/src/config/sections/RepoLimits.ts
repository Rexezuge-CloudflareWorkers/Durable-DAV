import { EnvParser } from '../EnvParser';
import {
  DEFAULT_MAX_REPOS_PER_USER,
  DEFAULT_MAX_VOLUMES_PER_USER,
  DEFAULT_DO_DEVICE_BYTES,
  DEFAULT_MAX_RULES_PER_REPO,
  DEFAULT_MAX_TOKENS_PER_USER,
  DEFAULT_MAX_TOKEN_EXPIRY_DAYS,
  DEFAULT_MAX_TOKEN_VOLUME_GRANTS,
  DEFAULT_MAX_TOKEN_REPO_GRANTS,
  DEFAULT_MAX_TEAMS_PER_ORG,
  DEFAULT_MAX_TEAM_GRANTS,
  DEFAULT_MAX_TEAM_MEMBERS,
  DEFAULT_MAX_SNIPPETS_PER_USER,
  DEFAULT_MAX_FILES_PER_SNIPPET,
  DEFAULT_MAX_SNIPPET_BYTES,
  DEFAULT_MAX_CREDENTIALS_PER_VOLUME,
  DEFAULT_DEFAULT_CREDENTIAL_EXPIRY_DAYS,
  DEFAULT_MAX_CREDENTIAL_EXPIRY_DAYS,
} from '../ConfigurationDefaults';

// Repository / identity limits.
class RepoLimits {
  constructor(private readonly env: unknown) {}

  public getMaxReposPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_REPOS_PER_USER', DEFAULT_MAX_REPOS_PER_USER);
  }

  public getMaxVolumesPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_VOLUMES_PER_USER', DEFAULT_MAX_VOLUMES_PER_USER);
  }

  public getMaxTokensPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TOKENS_PER_USER', DEFAULT_MAX_TOKENS_PER_USER);
  }

  public getMaxTokenExpiryDays(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TOKEN_EXPIRY_DAYS', DEFAULT_MAX_TOKEN_EXPIRY_DAYS);
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

  public getMaxTokenVolumeGrants(): number {
    // New primary var with legacy fallback: existing deploys that set only
    // `MAX_TOKEN_REPO_GRANTS` keep their cap.
    const raw = (this.env as Record<string, unknown> | null | undefined)?.['MAX_TOKEN_VOLUME_GRANTS'];
    if (typeof raw === 'string' && raw.trim() !== '') {
      return EnvParser.positiveInt(this.env, 'MAX_TOKEN_VOLUME_GRANTS', DEFAULT_MAX_TOKEN_VOLUME_GRANTS);
    }
    const legacy = (this.env as Record<string, unknown> | null | undefined)?.['MAX_TOKEN_REPO_GRANTS'];
    if (typeof legacy === 'string' && legacy.trim() !== '') {
      return EnvParser.positiveInt(this.env, 'MAX_TOKEN_REPO_GRANTS', DEFAULT_MAX_TOKEN_REPO_GRANTS);
    }
    return EnvParser.positiveInt(this.env, 'MAX_TOKEN_VOLUME_GRANTS', DEFAULT_MAX_TOKEN_VOLUME_GRANTS);
  }

  public getMaxTokenRepoGrants(): number {
    return this.getMaxTokenVolumeGrants();
  }

  public getMaxRulesPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_RULES_PER_REPO', DEFAULT_MAX_RULES_PER_REPO);
  }

  public getMaxTeamsPerOrg(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TEAMS_PER_ORG', DEFAULT_MAX_TEAMS_PER_ORG);
  }

  public getMaxTeamMembers(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TEAM_MEMBERS', DEFAULT_MAX_TEAM_MEMBERS);
  }

  public getMaxTeamGrants(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TEAM_GRANTS', DEFAULT_MAX_TEAM_GRANTS);
  }

  public getMaxSnippetsPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_SNIPPETS_PER_USER', DEFAULT_MAX_SNIPPETS_PER_USER);
  }

  public getMaxFilesPerSnippet(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FILES_PER_SNIPPET', DEFAULT_MAX_FILES_PER_SNIPPET);
  }

  public getMaxSnippetBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_SNIPPET_BYTES', DEFAULT_MAX_SNIPPET_BYTES);
  }

  public getDoDeviceBytes(): number {
    return EnvParser.positiveInt(this.env, 'DO_DEVICE_BYTES', DEFAULT_DO_DEVICE_BYTES);
  }
}

export { RepoLimits };
