import type { TokenScope } from './token';

export interface TokenVolumeGrantMetadata {
  tokenId: string;
  volumeId: string;
  owner: string;
  name: string;
  fullName: string;
  scope: TokenScope;
}
