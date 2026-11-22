import { describe, expect, it } from 'vitest';
import { toCreatedCredentialJson, toCredentialJson } from '../apps/api/src/workers/routes/credentialProjection';

/**
 * The credential wire shape: an explicit allow-list, not a row copy.
 *
 * A projection that grew by spreading the DAO row would publish the next
 * secret-bearing column by default (the password hash today). These pin both
 * shapes field-by-field: the listing carries no secret material, and the
 * create response carries the plaintext exactly once.
 */
const row = {
  credentialId: 'cred_1',
  name: 'deploy-key',
  username: 'volume-brave-otter-42',
  passwordPrefix: 'ddav_',
  passwordLastFour: '9f3a',
  createdAt: 1_700_000_000,
  expiresAt: 1_731_536_000,
  lastUsedAt: 1_700_000_100,
  readOnly: false,
  isServer: false,
};

describe('credential projection', () => {
  it('lists every display field and no secret material', () => {
    expect(toCredentialJson(row)).toEqual({
      credentialId: 'cred_1',
      name: 'deploy-key',
      username: 'volume-brave-otter-42',
      passwordPrefix: 'ddav_',
      passwordLastFour: '9f3a',
      createdAt: 1_700_000_000,
      expiresAt: 1_731_536_000,
      lastUsedAt: 1_700_000_100,
      readOnly: false,
      isServer: false,
    });
  });

  it('reveals the plaintext only on create, without the bookkeeping timestamps', () => {
    const body = toCreatedCredentialJson(row, 'ddav_secret-value');
    expect(body['password']).toBe('ddav_secret-value');
    expect(body).not.toHaveProperty('lastUsedAt');
    expect(body).not.toHaveProperty('createdAt');
  });

  it('publishes the server flag and a null expiry, never the stored sentinel', () => {
    const serverRow = { ...row, isServer: true, expiresAt: 253_402_300_799 };
    expect(toCredentialJson(serverRow)).toMatchObject({ isServer: true, expiresAt: null });
    expect(toCreatedCredentialJson(serverRow, 'ddav_secret-value')).toMatchObject({ isServer: true, expiresAt: null });
    expect(toCredentialJson(serverRow)).not.toContain(253_402_300_799);
  });

  it('does not add any field beyond the allowlist for a server credential', () => {
    const serverRow = { ...row, isServer: true };
    expect(Object.keys(toCredentialJson(serverRow)).sort()).toEqual([
      'createdAt',
      'credentialId',
      'expiresAt',
      'isServer',
      'lastUsedAt',
      'name',
      'passwordLastFour',
      'passwordPrefix',
      'readOnly',
      'username',
    ]);
  });
});
