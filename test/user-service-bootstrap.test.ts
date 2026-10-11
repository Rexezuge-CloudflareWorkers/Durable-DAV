import { describe, expect, it } from 'vitest';
import { UserService } from '../packages/backend-services/src/user/UserService';

/**
 * `UserService`'s sign-in path: resolve-then-create, the handle bootstrap, and
 * the two lookups.
 *
 * Every case runs against fake DAOs rather than a fake D1, because what is
 * under test is the *service's* ordering — which account an address resolves
 * to, and what a failed bootstrap is allowed to cost — and a fake D1 would
 * re-test the DAOs the other suites already cover. The kit's `first()`
 * answering `null` for "no row" is load-bearing here: `resolveAccount` treats
 * a missing row as absent, and these tests pin that a still-absent account is
 * *created*, not mistaken for a lookup failure.
 */

interface FakeUserRow {
  id?: string | null;
  email: string;
  current_email?: string | null;
  username: string | null;
  created_at: number;
  updated_at: number;
}

interface Store {
  users: FakeUserRow[];
  emails: Array<{ email: string; user_id: string; is_verified: number }>;
  namespaces: Array<{ username_ci: string; kind: 'user'; user_email: string | null; user_id?: string | null }>;
}

function newStore(): Store {
  return { users: [], emails: [], namespaces: [] };
}

/**
The DAO surface `UserService` touches, over one in-memory store.
*/
function daosFor(store: Store, failEnsureUsername = false) {
  return {
    userDAO: () =>
      Promise.resolve({
        createUser: async (input: { anchor: string; loginEmail: string; now: number }) => {
          // Mirrors the kit's `ON CONFLICT DO NOTHING` plus read-back: a taken
          // anchor reports `null` so the caller retries under an opaque anchor,
          // and a fresh insert reports its id.
          if (store.users.some((u) => u.email === input.anchor)) return null;
          const id = `usr_test_${store.users.length + 1}`;
          store.users.push({
            id,
            email: input.anchor,
            current_email: input.loginEmail,
            username: null,
            created_at: input.now,
            updated_at: input.now,
          });
          return id;
        },
        getByEmail: async (anchor: string) => store.users.find((u) => u.email === anchor),
        getById: async (id: string) => store.users.find((u) => u.id === id),
        getByCurrentEmail: async (address: string) =>
          store.users.find((u) => (u.current_email ?? '').toLowerCase() === address.toLowerCase()),
        getByUsernameCi: async (handleCi: string) => store.users.find((u) => (u.username ?? '').toLowerCase() === handleCi) ?? null,
        ensureUsername: async (id: string, handle: string, now: number) => {
          // The bootstrap is best-effort; a failure here must not fail sign-in,
          // which is exactly what the "still signs in" case below pins.
          if (failEnsureUsername) throw new Error('D1_ERROR: no such table: namespaces');
          const row = store.users.find((u) => u.id === id);
          if (!row) {
            return;
          }

          row.username = handle;
          row.updated_at = now;
        },
      } as never),
    userEmailDAO: () =>
      Promise.resolve({
        get: async (email: string) => store.emails.find((e) => e.email === email),
        register: async (input: { email: string; userId: string; isVerified: boolean; now: number }) => {
          // `ON CONFLICT(email) DO UPDATE`: a row already *verified* for another
          // account is left alone — an address in use cannot be stolen — while a
          // revoked row is replaced, which is what releases a moved-from address
          // for re-registration. Modelling the `DO NOTHING` form instead strands
          // every changed-from address forever.
          const existing = store.emails.find((e) => e.email === input.email);
          if (existing) {
            if (existing.is_verified === 1) return 'already-claimed' as const;
            existing.user_id = input.userId;
            existing.is_verified = input.isVerified ? 1 : 0;
            return 'claimed' as const;
          }
          store.emails.push({ email: input.email, user_id: input.userId, is_verified: input.isVerified ? 1 : 0 });
          return 'claimed' as const;
        },
      } as never),
    namespaceDAO: () =>
      Promise.resolve({
        get: async (handleCi: string) => store.namespaces.find((n) => n.username_ci === handleCi),
        isTaken: async (handleCi: string) => store.namespaces.some((n) => n.username_ci === handleCi),
        claimIgnore: async (input: { usernameCi: string; kind: 'user'; userEmail: string; userId: string; now: number }) => {
          store.namespaces.push({
            username_ci: input.usernameCi,
            kind: input.kind,
            user_email: input.userEmail,
            user_id: input.userId,
          });
        },
      } as never),
    volumeDAO: () => Promise.resolve({} as never),
  };
}

function serviceFor(store: Store, failEnsureUsername = false): UserService {
  return new UserService({ DB: {} as never }, daosFor(store, failEnsureUsername) as never);
}

describe('UserService.upsertUser — resolve-then-create', () => {
  it('keeps the existing account for an address that has already moved', async () => {
    // Resolution goes through the registry, not `users.email`: a user who
    // changed address must keep their account instead of acquiring a second,
    // empty one. The old address stays registered (revoked), so only the
    // current address resolves.
    const store = newStore();
    store.users.push({
      id: 'usr_alice',
      email: 'alice@example.com',
      current_email: 'new@example.com',
      username: 'alice',
      created_at: 1,
      updated_at: 1,
    });
    store.emails.push({ email: 'new@example.com', user_id: 'usr_alice', is_verified: 1 }, { email: 'alice@example.com', user_id: 'usr_alice', is_verified: 0 });

    const summary = await serviceFor(store).upsertUser('NEW@example.com');

    expect(summary).toEqual({ id: 'usr_alice', email: 'new@example.com', username: 'alice' });
    expect(store.users).toHaveLength(1);
  });

  it('registers an unknown address and claims a handle derived from the anchor', async () => {
    const store = newStore();

    const summary = await serviceFor(store).upsertUser('Bob.Smith@example.com');

    expect(store.users).toHaveLength(1);
    // The handle is written and claimed in the registry…
    expect(store.users[0]?.username).toBe('bob-smith');
    expect(store.namespaces.map((n) => n.username_ci)).toEqual(['bob-smith']);
    // …while the summary is the account `upsertUser` *resolved*, not a re-read
    // after the bootstrap: `registerAccount` resolves the row it just inserted,
    // which still has no handle. A freshly registered caller therefore reads
    // `username: null` here and takes the handle from the store it just wrote.
    // Pinned so a change on either side is deliberate.
    expect(summary).toMatchObject({ id: store.users[0]?.id, email: 'bob.smith@example.com', username: null });
  });

  it('falls back to an opaque anchor when the address is still another account\'s', async () => {
    // `registerAccount` reads the anchor row back and requires its own id; when
    // the address is held as a previous holder's anchor the write is a no-op and
    // the read-back disagrees, so the caller retries with an opaque anchor.
    // A released address must stay claimable by a later holder rather than being
    // stranded forever behind a row that can never be re-registered.
    const store = newStore();
    store.users.push({
      id: 'usr_previous',
      email: 'reused@example.com',
      current_email: 'moved@example.com',
      username: 'previous',
      created_at: 1,
      updated_at: 1,
    });
    // The revoked registry row is what makes the address *not resolve*: the
    // account moved off it, so it must neither authenticate the previous
    // holder nor fall through to the anchor lookup.
    store.emails.push({ email: 'reused@example.com', user_id: 'usr_previous', is_verified: 0 });

    const summary = await serviceFor(store).upsertUser('reused@example.com');

    expect(summary.id).not.toBe('usr_previous');
    // The opaque anchor is `.invalid` (RFC 2606) and can never be delivered to,
    // so it can never authenticate either.
    expect(store.users.at(-1)?.email).toMatch(/^anchor-[0-9a-f]+@users\.invalid$/);
    // …and the handle still comes from the *anchor*, so it stays readable.
    expect(store.users.at(-1)?.username).toMatch(/^anchor-/);
  });

  it('still signs in when the handle bootstrap cannot complete', async () => {
    // A missing handle must not prevent sign-in: on a database without
    // `namespaces`, `users.username` is authoritative and the bootstrap is
    // deliberately best-effort. Resolution, by contrast, propagates.
    const store = newStore();

    const summary = await serviceFor(store, true).upsertUser('carol@example.com');

    expect(summary.email).toBe('carol@example.com');
    expect(summary.id).toMatch(/^usr_/);
    expect(store.namespaces).toHaveLength(0);
  });
});

describe('UserService lookups', () => {
  it('finds a profile by address, and reports nothing for an unknown one', async () => {
    const store = newStore();
    store.users.push({
      id: 'usr_alice',
      email: 'alice@example.com',
      current_email: 'alice@example.com',
      username: 'alice',
      created_at: 1,
      updated_at: 1,
    });
    store.emails.push({ email: 'alice@example.com', user_id: 'usr_alice', is_verified: 1 });

    const service = serviceFor(store);
    await expect(service.getProfileByEmail('alice@example.com')).resolves.toEqual({
      id: 'usr_alice',
      email: 'alice@example.com',
      username: 'alice',
    });
    await expect(service.getProfileByEmail('nobody@example.com')).rejects.toThrow(/not found/i);
  });

  it('looks a handle up case-insensitively', async () => {
    // The column carries no COLLATE NOCASE and every writer stores lowercase,
    // so a read that did not fold its parameter would never find the row.
    const store = newStore();
    store.users.push({
      id: 'usr_alice',
      email: 'alice@example.com',
      current_email: 'alice@example.com',
      username: 'alice',
      created_at: 1,
      updated_at: 1,
    });

    await expect(serviceFor(store).getByUsername('ALICE')).resolves.toMatchObject({ id: 'usr_alice' });
    await expect(serviceFor(store).getByUsername('nobody')).resolves.toBeNull();
  });

  it('propagates a database failure rather than reporting the handle free', async () => {
    // A `null` return now means exactly one thing: no such row. It used to
    // `catch` and return null, which made the availability endpoint report
    // "taken, pick another" during a D1 outage.
    const service = new UserService(
      { DB: {} as never },
      {
        ...daosFor(newStore()),
        userDAO: () =>
          Promise.resolve({
            getByUsernameCi: async () => {
              throw new Error('D1_ERROR: database is locked');
            },
          } as never),
      } as never,
    );

    await expect(service.getByUsername('alice')).rejects.toThrow(/locked/);
  });
});
