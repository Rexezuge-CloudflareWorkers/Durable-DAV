import type { CurrentUser } from '../types';
import { apiGet, apiPatch } from '../lib/api';

// Deduplicates concurrent mounts (e.g. StrictMode double-effects) so the
// shell issues a single `GET /user/me`. Cleared on settle so a later
// explicit reload (e.g. after a username rename) refetches. A holder object
// (not a reassigned binding) keeps the shared inflight request.
const currentUserRequest: { inflight: Promise<CurrentUser> | null } = { inflight: null };

export async function loadCurrentUser(): Promise<CurrentUser> {
  currentUserRequest.inflight ??= apiGet<CurrentUser>('/user/me').finally(() => {
    currentUserRequest.inflight = null;
  });
  return currentUserRequest.inflight;
}

export async function renameCurrentUsername(username: string): Promise<CurrentUser> {
  return apiPatch<CurrentUser>('/user/me/username', { username });
}
