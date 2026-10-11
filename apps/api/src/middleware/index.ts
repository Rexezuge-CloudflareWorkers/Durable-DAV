export { MiddlewareHandlers } from './MiddlewareHandlers';
export type { RequestContext } from './MiddlewareHandlers';
export { scopeMiddleware } from './scopeMiddleware';
export { rateLimit, clientIp } from '@rexezuge/http';
export type { RateLimitContext, RateLimitHandler, RateLimitOptions } from '@rexezuge/http';
export { resetRateLimitForTests } from './rateLimitConfig';
export { RATE_LIMIT_DEFS, registerRateLimits } from './rateLimitConfig';
export { securityHeaders, applySecurityHeaders, sensitivePaths, SECURITY_HEADERS, CONTENT_SECURITY_POLICY, STRICT_TRANSPORT_SECURITY } from '@rexezuge/http';
export type { HeaderContext } from '@rexezuge/http';
import { sensitivePaths as buildSensitivePaths } from '@rexezuge/http';
/**
 * The private-prefix predicate for this worker's route table.
 *
 * Built from the kit's factory rather than hand-rolled: every `/user/*` JSON
 * response is `no-store` (credentials, volumes) while public volume reads stay
 * cacheable. A predicate copied from another router's table is how one repo
 * shipped a `no-store` that never matched anything — this one names its own
 * paths, and the compiler requires the argument at every `securityHeaders()`
 * call site.
 */
const isSensitiveJsonPath: (pathname: string) => boolean = buildSensitivePaths('/user/');
export { isSensitiveJsonPath };
export { davAuthForVolume, unauthorizedDav } from './DavAuth';
