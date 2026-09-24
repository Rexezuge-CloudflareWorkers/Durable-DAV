class EnvParser {
  public static positiveInt(env: unknown, key: string, defaultValue: string): number {
    const value = this.readString(env, key);
    const parsed = Number(value ?? defaultValue);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number(defaultValue);
  }

  public static nonNegativeInt(env: unknown, key: string, defaultValue: string): number {
    const value = this.readString(env, key);
    const parsed = Number(value ?? defaultValue);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number(defaultValue);
  }

  /**
   * Strict variant (why: silent fallback hides misconfiguration — e.g.
   * `MAX_PACK_OBJECTS=banana` silently becomes 10000). Throws on an
   * explicitly-set but malformed value; falls back only when unset.
   * Breaking: callers opting into strict mode fail fast instead of running
   * with defaults. Used by `AppConfiguration.validate()`.
   */
  public static strictPositiveInt(env: unknown, key: string, defaultValue: string): number {
    const value = this.readString(env, key);
    if (value === undefined) return Number(defaultValue);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid configuration: ${key} must be a positive integer (got ${JSON.stringify(value)})`);
    }
    return parsed;
  }

  public static isValidPositiveInt(env: unknown, key: string): boolean {
    const value = this.readString(env, key);
    if (value === undefined) return true;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0;
  }

  public static string(env: unknown, key: string, defaultValue: string): string {
    return this.readString(env, key) ?? defaultValue;
  }

  public static boolean(env: unknown, key: string, defaultValue: string): boolean {
    return (this.readString(env, key) ?? defaultValue) === 'true';
  }

  private static readString(env: unknown, key: string): string | undefined {
    return (env as Record<string, string | undefined>)[key];
  }
}

export { EnvParser };
