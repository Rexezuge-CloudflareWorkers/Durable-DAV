import type { CurrentUser } from '../types';
import { apiGet } from '../lib/api';

// Deduplicates concurrent mounts (e.g. StrictMode double-effects) so the
// shell issues a single `GET /user/me`. Cleared on settle so a later
// explicit reload refetches. A holder object (not a reassigned binding)
// keeps the shared inflight request.
const currentUserRequest: { inflight: Promise<CurrentUser> | null } = { inflight: null };

export async function loadCurrentUser(): Promise<CurrentUser> {
  currentUserRequest.inflight ??= apiGet<CurrentUser>('/user/me').finally(() => {
    currentUserRequest.inflight = null;
  });
  return currentUserRequest.inflight;
}
