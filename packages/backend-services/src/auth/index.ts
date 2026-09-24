export { AccessAuthService, DEFAULT_ACCESS_AUTH_STRATEGIES } from './AccessAuthService';
export type { AccessAuthEnv, AccessIdentityContext, AccessAuthStrategy } from './AccessAuthService';
export { TokenService } from './TokenService';
export type { CreatedToken, AuthenticatedToken, TokenServiceDeps, TokenServiceEnv } from './TokenService';
export {
  TOKEN_SCOPES,
  LEGACY_TOKEN_SCOPES,
  DEFAULT_TOKEN_SCOPES,
  coversScope,
  normalizeTokenScopes,
  normalizeScopeAlias,
} from './TokenScopes';
