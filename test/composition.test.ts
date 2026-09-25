import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '@durable-dav/backend-runtime/di';
import { Tokens, createRequestScope } from '@durable-dav/backend-services/composition';
import { VolumeService } from '@durable-dav/backend-services/dav';
import { UserService } from '@durable-dav/backend-services/user';

// Otter mock pattern: hoisted shared vi.fn refs exposed through the mocked
// `@durable-dav/backend-data/dao` module. `vi.mock` factories cannot reference
// top-level bindings, hence `vi.hoisted`.
const daoMocks = vi.hoisted(() => ({
  UserDAO: vi.fn(),
  UserAccessTokenDAO: vi.fn(),
  NamespaceDAO: vi.fn(),
  TokenVolumeGrantDAO: vi.fn(),
  DavVolumeDAO: vi.fn(),
  DavCollaboratorDAO: vi.fn(),
}));

vi.mock('@durable-dav/backend-data/dao', () => ({
  UserDAO: daoMocks.UserDAO,
  UserAccessTokenDAO: daoMocks.UserAccessTokenDAO,
  NamespaceDAO: daoMocks.NamespaceDAO,
  TokenVolumeGrantDAO: daoMocks.TokenVolumeGrantDAO,
  DavVolumeDAO: daoMocks.DavVolumeDAO,
  DavCollaboratorDAO: daoMocks.DavCollaboratorDAO,
}));

const EXPECTED_TOKENS = [
  'Env',
  'Db',
  'KvCache',
  'AppConfig',
  'UserDAO',
  'UserAccessTokenDAO',
  'NamespaceDAO',
  'TokenVolumeGrantDAO',
  'DavVolumeDAO',
  'DavCollaboratorDAO',
  'AccessAuthService',
  'TokenService',
  'UserService',
  'DavPermissionService',
  'VolumeService',
] as const;

function makeEnv() {
  return { DB: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  // NOTE: `function` (not arrow) implementations — daoBindings.ts builds DAOs
  // via `new UserDAO(db)`, and arrow functions are not constructible.
  daoMocks.UserDAO.mockImplementation(function (this: unknown, db: unknown) {
    return { kind: 'UserDAO', db };
  });
  daoMocks.UserAccessTokenDAO.mockImplementation(function (this: unknown, db: unknown) {
    return { kind: 'UserAccessTokenDAO', db };
  });
  daoMocks.NamespaceDAO.mockImplementation(function (this: unknown, db: unknown) {
    return { kind: 'NamespaceDAO', db };
  });
  daoMocks.TokenVolumeGrantDAO.mockImplementation(function (this: unknown, db: unknown) {
    return { kind: 'TokenVolumeGrantDAO', db };
  });
  daoMocks.DavVolumeDAO.mockImplementation(function (this: unknown, db: unknown) {
    return { kind: 'DavVolumeDAO', db };
  });
  daoMocks.DavCollaboratorDAO.mockImplementation(function (this: unknown, db: unknown) {
    return { kind: 'DavCollaboratorDAO', db };
  });
});

describe('Tokens registry', () => {
  it('exposes one distinct symbol per binding', () => {
    for (const key of EXPECTED_TOKENS) {
      expect(typeof Tokens[key]).toBe('symbol');
    }
    expect(new Set(EXPECTED_TOKENS.map((key) => Tokens[key])).size).toBe(EXPECTED_TOKENS.length);
  });

  it('binds every token in a fresh request scope', () => {
    const scope = createRequestScope(makeEnv() as never);
    for (const key of EXPECTED_TOKENS) {
      expect(scope.has(Tokens[key])).toBe(true);
    }
  });
});

describe('createRequestScope', () => {
  it('shares Env/Db values and memoizes services per scope', () => {
    const env = makeEnv();
    const scope = createRequestScope(env as never);
    expect(scope).toBeInstanceOf(Container);
    expect(scope.get(Tokens.Env)).toBe(env);
    expect(scope.get(Tokens.Db)).toBe(env.DB);
    expect(scope.get(Tokens.VolumeService)).toBe(scope.get(Tokens.VolumeService));
    expect(scope.get(Tokens.VolumeService)).toBeInstanceOf(VolumeService);
    expect(scope.get(Tokens.UserService)).toBeInstanceOf(UserService);
    expect(scope.get(Tokens.UserService)).toBe(scope.get(Tokens.UserService));
  });

  it('isolates singletons between scopes', () => {
    const env = makeEnv() as never;
    const first = createRequestScope(env);
    const second = createRequestScope(env);
    expect(first).not.toBe(second);
    expect(first.get(Tokens.VolumeService)).not.toBe(second.get(Tokens.VolumeService));
  });

  it('memoizes DAO factories so each DAO is constructed once', async () => {
    const scope = createRequestScope(makeEnv() as never);
    const pairs = [
      [Tokens.UserDAO, daoMocks.UserDAO],
      [Tokens.UserAccessTokenDAO, daoMocks.UserAccessTokenDAO],
      [Tokens.NamespaceDAO, daoMocks.NamespaceDAO],
      [Tokens.TokenVolumeGrantDAO, daoMocks.TokenVolumeGrantDAO],
      [Tokens.DavVolumeDAO, daoMocks.DavVolumeDAO],
      [Tokens.DavCollaboratorDAO, daoMocks.DavCollaboratorDAO],
    ] as const;
    for (const [token, mock] of pairs) {
      const first = await scope.get(token)();
      const second = await scope.get(token)();
      expect(first).toBe(second);
      expect(mock).toHaveBeenCalledTimes(1);
    }
  });

  it('builds DAOs lazily — untouched DAOs are never constructed', async () => {
    const scope = createRequestScope(makeEnv() as never);
    expect(daoMocks.UserDAO).not.toHaveBeenCalled();
    await scope.get(Tokens.UserDAO)();
    expect(daoMocks.UserDAO).toHaveBeenCalledTimes(1);
    expect(daoMocks.DavVolumeDAO).not.toHaveBeenCalled();
  });
});
