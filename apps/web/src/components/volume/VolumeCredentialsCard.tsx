import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BucketCredential, CreatedBucketCredential } from '../../types';
import { listBucketCredentials, revokeBucketCredential, setBucketCredentialReadOnly } from '../../services/credentialService';
import { formatExpiryTimestamp } from '../../lib/format';
import { toLocalizedErrorMessage } from '../../lib/backendErrors';
import { Badge, Button, Card, CardHeader, CardTitle, ReadOnlyField, RefreshButton } from '@rexezuge/web';
import { ConfirmDeleteModal } from '../modals/ConfirmDeleteModal';
import { CredentialCreateForm } from './CredentialCreateForm';

export function VolumeCredentialsCard({
  owner,
  volume,
  showNotice,
}: {
  owner: string;
  volume: string;
  showNotice: (type: 'success' | 'error', text: string) => void;
}) {
  const { t } = useTranslation();
  const [credentials, setCredentials] = useState<BucketCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastCreated, setLastCreated] = useState<{ username: string; password: string; readOnly: boolean; isServer: boolean } | null>(null);
  const [revoking, setRevoking] = useState<BucketCredential | null>(null);
  const [flipping, setFlipping] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const rows = await listBucketCredentials(owner, volume);
        if (cancelled) return;
        setCredentials(rows);
      } catch (error) {
        if (cancelled) return;
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToLoadCredentials', 'Failed To Load Credentials.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [owner, volume, reloadKey, showNotice, t]);

  const refresh = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  /**
  Both create forms share the copy-once reveal and the refresh.
  */
  const handleCreated = (created: CreatedBucketCredential) => {
    setLastCreated({ username: created.username, password: created.password, readOnly: created.readOnly, isServer: created.isServer });
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  /**
   * Flip a credential between read-only and full access.
   *
   * Optimistic: the row is patched locally first so the badge does not lag a
   * network round trip, and reverted from the server's answer on failure. The
   * credential is a bearer secret the client has already cached, so the server
   * cannot force the client to forget it — this toggle is a policy statement
   * that takes effect on the next request the client makes.
   */
  const toggleReadOnly = async (cred: BucketCredential) => {
    const next = !cred.readOnly;
    setFlipping(cred.credentialId);
    setCredentials((rows) => rows.map((row) => (row.credentialId === cred.credentialId ? { ...row, readOnly: next } : row)));
    try {
      await setBucketCredentialReadOnly(owner, volume, cred.credentialId, next);
      showNotice(
        'success',
        next ? t('credentials.nowReadOnly', 'Credential Is Now Read-Only.') : t('credentials.nowReadWrite', 'Credential Can Now Write.'),
      );
    } catch (error) {
      setCredentials((rows) => rows.map((row) => (row.credentialId === cred.credentialId ? { ...row, readOnly: cred.readOnly } : row)));
      showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToUpdateCredential', 'Failed To Update Credential.'));
    } finally {
      setFlipping(null);
    }
  };

  const confirmRevoke = async () => {
    if (!revoking) return;
    try {
      await revokeBucketCredential(owner, volume, revoking.credentialId);
      showNotice('success', t('credentials.revoked', 'Credential Revoked.'));
      setLoading(true);
      setReloadKey((k) => k + 1);
    } catch (error) {
      showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToRevokeCredential', 'Failed To Revoke Credential.'));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('credentials.bucketCredentials', 'Bucket Credentials')}</CardTitle>
        <RefreshButton onRefresh={refresh} loading={loading} label={t('common.refresh', 'Refresh')} />
      </CardHeader>
      <p className="text-sm text-[var(--color-text-secondary)] mb-3">
        {t('credentials.hint', 'Each Credential Unlocks Only This Bucket. Use The Generated Username And Password As WebDAV Basic Auth.')}
      </p>
      <div className="space-y-3">
        <CredentialCreateForm owner={owner} volume={volume} server={false} showNotice={showNotice} onCreated={handleCreated} />
        <div className="border-t border-[var(--color-border)] pt-3 space-y-2">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('credentials.serverTitle', 'Server Credentials')}</p>
          <CredentialCreateForm owner={owner} volume={volume} server showNotice={showNotice} onCreated={handleCreated} />
        </div>
      </div>
      {lastCreated && (
        <div className="mt-4 space-y-2">
          <ReadOnlyField
            label={t('credentials.newUsername', 'New Username')}
            value={lastCreated.username}
            showCopy
            copyLabel={t('common.copyToClipboard', 'Copy To Clipboard')}
          />
          <ReadOnlyField
            label={t('credentials.newPassword', 'New Password (Copy Once)')}
            value={lastCreated.password}
            showCopy
            copyLabel={t('common.copyToClipboard', 'Copy To Clipboard')}
          />
          {lastCreated.isServer && <Badge variant="info">{t('credentials.serverBadge', 'Server Credential · Never Expires')}</Badge>}
          {lastCreated.readOnly && <Badge variant="info">{t('credentials.readOnlyBadge', 'Read-Only Access')}</Badge>}
        </div>
      )}
      <ul className="mt-4 divide-y divide-[var(--color-border)]">
        {credentials.map((cred) => (
          <li key={cred.credentialId} className="py-3 flex items-center justify-between gap-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="font-medium text-[var(--color-text-primary)] truncate">
                {cred.name}
                <span className="ml-2 font-mono text-xs text-[var(--color-text-muted)]">
                  {cred.username} · {cred.passwordPrefix}…{cred.passwordLastFour}
                </span>
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {cred.isServer ? t('credentials.serverBadge', 'Server Credential · Never Expires') : formatExpiryTimestamp(cred.expiresAt)}
                {cred.readOnly && <span className="ml-2">{t('credentials.readOnlyBadge', 'Read-Only Access')}</span>}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="secondary" size="sm" loading={flipping === cred.credentialId} onClick={() => void toggleReadOnly(cred)}>
                {cred.readOnly ? t('credentials.allowWrites', 'Allow Writes') : t('credentials.makeReadOnly', 'Make Read-Only')}
              </Button>
              <Button variant="danger" size="sm" onClick={() => setRevoking(cred)}>
                {t('credentials.revoke', 'Revoke')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {credentials.length === 0 && !loading && (
        <p className="text-sm text-[var(--color-text-muted)] mt-4">{t('credentials.empty', 'No Credentials Yet.')}</p>
      )}
      {revoking && (
        <ConfirmDeleteModal
          title={t('credentials.revokeCredential', 'Revoke Credential')}
          displayName={revoking.name}
          onConfirm={() => void confirmRevoke()}
          onCancel={() => setRevoking(null)}
        />
      )}
    </Card>
  );
}
