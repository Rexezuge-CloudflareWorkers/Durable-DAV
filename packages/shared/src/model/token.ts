export type TokenScope = 'dav:read' | 'dav:write' | 'admin' | 'repo:read' | 'repo:write';

export interface UserAccessTokenMetadata {
  tokenId: string;
  userEmail: string;
  tokenHash: string;
  name: string;
  expiresAt: number;
  lastUsedAt: number | null;
  createdAt: number;
  scopes: TokenScope[];
  tokenPrefix: string | null;
  volumeGrants?: import('./transfer').TokenVolumeGrantMetadata[];
}
