export interface DavCredentialMetadata {
  credentialId: string;
  volumeId: string;
  name: string;
  username: string;
  passwordPrefix: string;
  passwordLastFour: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
}

export interface DavCredentialInternal {
  credential_id: string;
  volume_id: string;
  username: string;
  password_hash: string;
  name: string;
  password_prefix: string;
  password_last_four: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
}
