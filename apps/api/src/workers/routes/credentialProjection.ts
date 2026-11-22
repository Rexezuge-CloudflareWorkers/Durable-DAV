/**
 * The wire shape of a bucket credential.
 *
 * Modelled on `replicationProjection`, and for the same reason: this is the only
 * thing standing between a stored credential and a client. Every field named
 * here is a field a client sees, and anything *not* named is not sent — so
 * adding a column to `dav_credentials` (a hash of some new factor, an internal
 * note, a verifier fingerprint) cannot publish itself. A projection that grew by
 * copying the row would leak the next such column by default.
 *
 * Two shapes, and the asymmetry between them is deliberate rather than an
 * inconsistency to tidy up:
 *
 * - {@link toCredentialJson} is the listing. Ten fields, no secret material.
 * - {@link toCreatedCredentialJson} adds `password`, because the plaintext is
 *   recoverable exactly once — at creation, to the caller who chose it — and
 *   never again. `lastUsedAt` and `createdAt` are omitted there because a
 *   just-created credential has a `lastUsedAt` of null and a `createdAt` the
 *   caller can already infer from the response it is holding.
 *
 * A server credential's `expiresAt` is published as `null` rather than the
 * far-future sentinel stored in D1. The sentinel is an implementation detail of
 * keeping the auth/prune SQL unchanged; a client only needs the fact that this
 * credential never expires, and already renders a null expiry as "Never".
 */

/**
The stored credential fields this projection reads. Named rather than a DAO row type
so the projection compiles against a shape, not against whatever the SELECT happens to
return — a new column in the query is then a type error here rather than a leak.
*/
interface CredentialRow {
  credentialId: string;
  name: string;
  username: string;
  passwordPrefix: string;
  passwordLastFour: string;
  createdAt: number | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  readOnly: boolean;
  isServer: boolean;
}

type CredentialJson = Record<string, unknown>;

/**
The listing shape. One credential as a client sees it.
*/
function toCredentialJson(row: CredentialRow): CredentialJson {
  return {
    credentialId: row.credentialId,
    name: row.name,
    username: row.username,
    // Enough to recognise a credential in a client without enough to use one.
    passwordPrefix: row.passwordPrefix,
    passwordLastFour: row.passwordLastFour,
    createdAt: row.createdAt,
    expiresAt: row.isServer ? null : row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    readOnly: row.readOnly,
    isServer: row.isServer,
  };
}

/**
The create response: the listing shape minus the two bookkeeping timestamps,
plus the one-time plaintext.

`readOnly` is echoed rather than omitted. The service rejects a non-boolean with
a `400`, but a caller who sent no flag at all still needs to see which default
was applied — silence would read as "the flag was not applied".
*/
function toCreatedCredentialJson(row: CredentialRow, password: string): CredentialJson {
  return {
    credentialId: row.credentialId,
    name: row.name,
    username: row.username,
    password,
    passwordPrefix: row.passwordPrefix,
    passwordLastFour: row.passwordLastFour,
    expiresAt: row.isServer ? null : row.expiresAt,
    readOnly: row.readOnly,
    isServer: row.isServer,
  };
}

export { toCredentialJson, toCreatedCredentialJson };
export type { CredentialRow, CredentialJson };
