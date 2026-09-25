/**
 * Canonical email value object.
 * Consolidates scattered `email.toLowerCase()` call sites into a single
 * normalization point. Layer 0 stays dependency-free: validation failures
 * throw plain `Error`; callers in layers 2-3 map to `BadRequestError`.
 */
const EMAIL_FORMAT_RE = /^[^@\s]+@[^\s@][^\s.@]*\.[^\s@]+$/;

function isValidEmailFormat(raw: string): boolean {
  return raw !== '' && raw.length <= 254 && EMAIL_FORMAT_RE.test(raw);
}

class EmailAddress {
  private constructor(private readonly canonical: string) {}

  public static normalize(email: string): string {
    return email.trim().toLowerCase();
  }

  public static parse(email: string): EmailAddress {
    const canonical = this.normalize(email);
    if (!canonical || !canonical.includes('@')) {
      throw new Error('Invalid email address');
    }
    return new this(canonical);
  }

  public static tryParse(email: string | null | undefined): EmailAddress | null {
    if (!email) return null;
    try {
      return this.parse(email);
    } catch {
      return null;
    }
  }

  public toString(): string {
    return this.canonical;
  }

  public valueOf(): string {
    return this.canonical;
  }

  public equals(other: EmailAddress | string): boolean {
    const rhs = typeof other === 'string' ? (this.constructor as typeof EmailAddress).normalize(other) : other.canonical;
    return this.canonical === rhs;
  }

  public prefix(): string {
    return this.canonical.split('@', 1)[0] ?? '';
  }
}

/**
 * Canonical `owner/name` identifier patterns.
 * `OWNER_PATTERN` validates usernames (also used for volume owners);
 * `REPO_PATTERN` validates volume names.
 */
const OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const REPO_PATTERN = /^[\w.-]{1,100}$/i;

export { EmailAddress, OWNER_PATTERN, REPO_PATTERN, isValidEmailFormat };
