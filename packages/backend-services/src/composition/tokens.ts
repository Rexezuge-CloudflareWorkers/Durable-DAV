import type {
  DavCollaboratorDAO,
  DavVolumeDAO,
  NamespaceDAO,
  TokenVolumeGrantDAO,
  UserAccessTokenDAO,
  UserDAO,
} from '@durable-dav/backend-data/dao';
import type { D1Queryable } from '@durable-dav/backend-data/utils';
import type { Token } from '@durable-dav/backend-runtime/di';
import type { AppConfiguration } from '@durable-dav/backend-runtime/config';
import type { KvCache } from '@durable-dav/backend-runtime/kv';
import type { AccessAuthService } from '../auth/AccessAuthService';
import type { TokenService } from '../auth/TokenService';
import type { UserService } from '../user/UserService';
import type { DavPermissionService } from '../dav/DavPermissionService';
import type { VolumeService } from '../dav/VolumeService';

// Central token registry for the per-request composition root
// (`requestScope.ts`). Call sites resolve services via
// `scope.get(Tokens.VolumeService)` instead of `new X(env)`.
//
// Tokens carry their value type (`Token<T>`) so `scope.get(...)` infers the
// service type without an explicit generic at call sites.
interface RequestScopeEnvShape {
  DB: D1Queryable;
}

const Tokens = {
  Env: Symbol('Env') as Token<RequestScopeEnvShape>,
  Db: Symbol('Db') as Token<D1Queryable>,
  KvCache: Symbol('KvCache') as Token<KvCache>,
  AppConfig: Symbol('AppConfig') as Token<AppConfiguration>,
  UserDAO: Symbol('UserDAO') as Token<() => Promise<UserDAO>>,
  UserAccessTokenDAO: Symbol('UserAccessTokenDAO') as Token<() => Promise<UserAccessTokenDAO>>,
  NamespaceDAO: Symbol('NamespaceDAO') as Token<() => Promise<NamespaceDAO>>,
  TokenVolumeGrantDAO: Symbol('TokenVolumeGrantDAO') as Token<() => Promise<TokenVolumeGrantDAO>>,
  DavVolumeDAO: Symbol('DavVolumeDAO') as Token<() => Promise<DavVolumeDAO>>,
  DavCollaboratorDAO: Symbol('DavCollaboratorDAO') as Token<() => Promise<DavCollaboratorDAO>>,
  AccessAuthService: Symbol('AccessAuthService') as Token<AccessAuthService>,
  TokenService: Symbol('TokenService') as Token<TokenService>,
  UserService: Symbol('UserService') as Token<UserService>,
  DavPermissionService: Symbol('DavPermissionService') as Token<DavPermissionService>,
  VolumeService: Symbol('VolumeService') as Token<VolumeService>,
} satisfies Record<string, Token<unknown>>;

export { Tokens };
