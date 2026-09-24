import type { CreatedToken, RotatedToken, TokenMetadata, TokenScope, VolumeGrantInput } from '../types';
import { apiDelete, apiGet, apiPost } from '../lib/api';

export async function listTokens(): Promise<TokenMetadata[]> {
  const data = await apiGet<{ tokens?: TokenMetadata[] }>('/user/tokens');
  return data.tokens ?? [];
}

export async function createToken(
  name: string,
  scopes?: TokenScope[],
  expiresInDays?: number,
  volumeGrants?: VolumeGrantInput[],
): Promise<CreatedToken> {
  return apiPost<CreatedToken>('/user/tokens', { name, scopes, expiresInDays, volumeGrants });
}

export async function rotateToken(tokenId: string): Promise<RotatedToken> {
  return apiPost<RotatedToken>(`/user/tokens/${encodeURIComponent(tokenId)}/rotate`);
}

export async function revokeToken(tokenId: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`/user/tokens/${encodeURIComponent(tokenId)}`);
}
