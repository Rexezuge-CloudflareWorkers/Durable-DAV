// Grouped DAO barrels — import from a domain group for readability
// (`@durable-dav/backend-data/dao/identity`), or from the root barrel.
//
// The user-account DAOs and the `users` row shape moved to
// `@rexezuge/identity`: the frozen-anchor design is the family's canonical one
// and shipping a second copy here is how it drifted before. `NamespaceDAO`
// stays this repo's, because the `namespaces` table is Durable-DAV's own
// username registry rather than the kit's account layer.
export { UserDAO, UserEmailDAO } from '@rexezuge/identity';
export type { UserRow, UserEmailRow, EmailClaim } from '@rexezuge/identity';
export { NamespaceDAO } from './NamespaceDAO';
export type { NamespaceKind, NamespaceRow } from './NamespaceDAO';
