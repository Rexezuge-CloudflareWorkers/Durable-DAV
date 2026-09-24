export type TokenScope = 'repo:read' | 'repo:write' | 'admin';

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
  repoGrants?: import('./transfer').TokenRepoGrantMetadata[];
}
