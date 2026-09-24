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

export type TokenScope = 'dav:read' | 'dav:write' | 'admin' | 'repo:read' | 'repo:write';

export interface TokenVolumeGrant {
  tokenId: string;
  volumeId: string;
  owner: string;
  name: string;
  fullName: string;
  scope: TokenScope;
}

export interface TokenMetadata {
  tokenId: string;
  name: string;
  expiresAt: number;
  lastUsedAt: number | null;
  createdAt: number;
  scopes: TokenScope[];
  tokenPrefix?: string | null;
  volumeGrants?: TokenVolumeGrant[];
}

export interface CreatedToken {
  tokenId: string;
  token: string;
  name: string;
  expiresAt: number;
  scopes: TokenScope[];
  prefix?: string;
}

export interface RotatedToken {
  token: string;
  expiresAt: number;
  prefix: string;
}

export interface VolumeGrantInput {
  owner: string;
  name: string;
  scope: TokenScope;
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
