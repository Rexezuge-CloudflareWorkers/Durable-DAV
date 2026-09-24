import type { UserProfile } from '../types';
import { apiGet } from '../lib/api';

export async function loadProfile(username: string): Promise<UserProfile> {
  return apiGet<UserProfile>(`/users/${encodeURIComponent(username)}`);
}
