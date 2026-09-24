import { describe, expect, it, vi } from 'vitest';
import { TokenService } from '@duradav/backend-services/auth';

function makeEnv() {
  return { DB: {} as never };
}

function makeTokenRow(tokenId: string, userEmail: string) {
  const now = Math.trunc(Date.now() / 1000);
  return {
    tokenId,
    userEmail,
    tokenHash: 'h',
    name: 't',
    createdAt: now,
    expiresAt: now + 86_400,
    lastUsedAt: null,
    scopes: ['dav:read'],
    prefix: 'abc',
  };
}

describe('TokenService scoped-grant fail-closed', () => {
  it('createToken rolls back the token when volume grant persistence fails', async () => {
    const deleted: string[] = [];
    const tokenDAO = {
      getByUserEmail: async () => [],
      create: async () => undefined,
      delete: async (tokenId: string) => {
        deleted.push(tokenId);
      },
    };
    const tokenVolumeGrantDAO = {
      setGrants: async () => {
        throw new Error('D1 down');
      },
    };
    const volumeDAO = {
      getByOwnerName: async () => ({ id: 'vol-1' }),
    };
    const svc = new TokenService(makeEnv(), {
      tokenDAO: () => Promise.resolve(tokenDAO as never),
      tokenVolumeGrantDAO: () => Promise.resolve(tokenVolumeGrantDAO as never),
      volumeDAO: () => Promise.resolve(volumeDAO as never),
      tokenGrantDAO: () => Promise.resolve({ setGrants: async () => undefined } as never),
      repositoryDAO: () => Promise.resolve({} as never),
    });
    await expect(
      svc.createToken('Alice@Example.com', 'scoped', 30, ['dav:read'], [{ owner: 'a', name: 'b', scope: 'dav:read' }]),
    ).rejects.toThrow(/volume grants/i);
    expect(deleted).toHaveLength(1);
  });

  it('createToken rolls back the token when legacy repo grant persistence fails', async () => {
    const deleted: string[] = [];
    const tokenDAO = {
      getByUserEmail: async () => [],
      create: async () => undefined,
      delete: async (tokenId: string) => {
        deleted.push(tokenId);
      },
    };
    const tokenGrantDAO = {
      setGrants: async () => {
        throw new Error('D1 down');
      },
    };
    const repositoryDAO = {
      getByOwnerAndName: async () => ({ id: 'repo-1' }),
    };
    const svc = new TokenService(makeEnv(), {
      tokenDAO: () => Promise.resolve(tokenDAO as never),
      tokenVolumeGrantDAO: () => Promise.resolve({ setGrants: async () => undefined, deleteByToken: async () => undefined } as never),
      volumeDAO: () => Promise.resolve({ getByOwnerName: async () => null } as never),
      tokenGrantDAO: () => Promise.resolve(tokenGrantDAO as never),
      repositoryDAO: () => Promise.resolve(repositoryDAO as never),
    });
    await expect(
      svc.createToken('Alice@Example.com', 'scoped', 30, ['dav:read'], undefined, [
        { owner: 'a', name: 'r', scope: 'dav:read' },
      ]),
    ).rejects.toThrow(/repository grants/i);
    expect(deleted).toHaveLength(1);
  });

  it('createToken without grants does not touch the grant DAOs', async () => {
    const setVolumeGrants = vi.fn();
    const setRepoGrants = vi.fn();
    const svc = new TokenService(makeEnv(), {
      tokenDAO: () => Promise.resolve({ getByUserEmail: async () => [], create: async () => undefined } as never),
      tokenVolumeGrantDAO: () => Promise.resolve({ setGrants: setVolumeGrants } as never),
      tokenGrantDAO: () => Promise.resolve({ setGrants: setRepoGrants } as never),
      volumeDAO: () => Promise.resolve({} as never),
      repositoryDAO: () => Promise.resolve({} as never),
    });
    const created = await svc.createToken('a@example.com', 'plain');
    expect(created.tokenId).toBeTruthy();
    expect(setVolumeGrants).not.toHaveBeenCalled();
    expect(setRepoGrants).not.toHaveBeenCalled();
  });

  it('listTokens propagates volume grant-read failures instead of showing []', async () => {
    const row = makeTokenRow('tid-1', 'a@example.com');
    const svc = new TokenService(makeEnv(), {
      tokenDAO: () => Promise.resolve({ getByUserEmail: async () => [row] } as never),
      tokenVolumeGrantDAO: () =>
        Promise.resolve({
          listByToken: async () => {
            throw new Error('D1 down');
          },
        } as never),
      tokenGrantDAO: () => Promise.resolve({ listByToken: async () => [] } as never),
      volumeDAO: () => Promise.resolve({} as never),
      repositoryDAO: () => Promise.resolve({} as never),
    });
    await expect(svc.listTokens('A@EXAMPLE.com')).rejects.toThrow();
  });

  it('listTokens propagates repo grant-read failures instead of showing []', async () => {
    const row = makeTokenRow('tid-1', 'a@example.com');
    const svc = new TokenService(makeEnv(), {
      tokenDAO: () => Promise.resolve({ getByUserEmail: async () => [row] } as never),
      tokenVolumeGrantDAO: () => Promise.resolve({ listByToken: async () => [] } as never),
      tokenGrantDAO: () =>
        Promise.resolve({
          listByToken: async () => {
            throw new Error('D1 down');
          },
        } as never),
      volumeDAO: () => Promise.resolve({} as never),
      repositoryDAO: () => Promise.resolve({} as never),
    });
    await expect(svc.listTokens('A@EXAMPLE.com')).rejects.toThrow();
  });

  it('rotateToken normalizes mixed-case email consistently', async () => {
    const row = makeTokenRow('tid-9', 'user@example.com');
    const seen: string[] = [];
    const svc = new TokenService(makeEnv(), {
      tokenDAO: () =>
        Promise.resolve({
          getByUserEmail: async (email: string) => {
            seen.push(email);
            return [row];
          },
          rotate: async () => true,
        } as never),
      tokenGrantDAO: () => Promise.resolve({} as never),
      repositoryDAO: () => Promise.resolve({} as never),
    });
    const out = await svc.rotateToken('tid-9', 'User@Example.COM');
    expect(out.token).toBeTruthy();
    expect(seen.every((e) => e === 'user@example.com')).toBe(true);
  });

  it('rotateToken refuses expired tokens instead of re-animating them', async () => {
    const now = Math.trunc(Date.now() / 1000);
    const expired = { ...makeTokenRow('tid-old', 'user@example.com'), createdAt: now - 90 * 86_400, expiresAt: now - 10 };
    const svc = new TokenService(makeEnv(), {
      tokenDAO: () => Promise.resolve({ getByUserEmail: async () => [expired], rotate: async () => true } as never),
      tokenGrantDAO: () => Promise.resolve({} as never),
      repositoryDAO: () => Promise.resolve({} as never),
    });
    await expect(svc.rotateToken('tid-old', 'user@example.com')).rejects.toThrow(/expired/i);
  });
});
