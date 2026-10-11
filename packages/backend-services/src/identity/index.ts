// The account layer is `@rexezuge/identity`'s: Durable-DAV's invariants — the
// frozen anchor, the verified-only address registry — are the family's
// canonical ones, so the service and the resolution functions are converged
// there rather than carried here. The service is still bound once per request
// scope in `composition/`; that wiring, not the class, is what this repo owns.
export { UserIdentityService } from '@rexezuge/identity';
export type { UserIdentityDeps, UserIdentityEnv } from '@rexezuge/identity';
