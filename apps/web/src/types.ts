export interface CurrentUser {
  email: string;
  username?: string | null;
  /**
   * Preferred UI language (BCP 47 tag). Optional: persisted locally only
   * (`localStorage > navigator > en`).
   */
  preferredLanguage?: string | null;
}

export interface Volume {
  owner: string;
  name: string;
  fullName: string;
  description?: string | null;
  isPrivate: boolean;
  href: string;
}

export interface VolumeDetail extends Volume {
  description: string | null;
}

export interface BucketCredential {
  credentialId: string;
  name: string;
  username: string;
  passwordPrefix: string;
  passwordLastFour: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
}

export interface CreatedBucketCredential {
  credentialId: string;
  username: string;
  password: string;
  name: string;
  expiresAt: number;
  passwordPrefix: string;
  passwordLastFour: string;
}

export interface UserProfile {
  username: string;
}

export interface DavEntry {
  href: string;
  name: string;
  path: string;
  isCollection: boolean;
  size: number | null;
  contentType: string | null;
  lastModified: string | null;
  etag: string | null;
}
