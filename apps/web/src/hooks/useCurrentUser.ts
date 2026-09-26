import { useEffect, useState } from 'react';
import type { CurrentUser } from '../types';
import { loadCurrentUser } from '../services/userService';
import { getBackendErrorStatus } from '../lib/api';

export function useCurrentUser(onError?: (message: string) => void) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCurrentUser()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setAuthorized(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Distinguish "not signed in" from "the server is broken". Collapsing
        // both into `authorized: false` sent a 500 or 503 on `/user/me` to the
        // landing page with no notice at all, so a transient outage looked
        // exactly like a logout.
        if (getBackendErrorStatus(error) === 401) {
          setAuthorized(false);
          return;
        }
        onError?.(error instanceof Error ? error.message : String(error));
        // Still "authorized" so the shell renders and the notice is visible;
        // the user object stays null, so owner-gated views show Unauthorized.
        setAuthorized(true);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  return { user, setUser, authorized };
}
