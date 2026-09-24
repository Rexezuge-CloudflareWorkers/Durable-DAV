import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import type { TokenMetadata, TokenScope, VolumeGrantInput } from '../../types';
import { createToken, listTokens, revokeToken, rotateToken } from '../../services/tokenService';
import { formatExpiryTimestamp } from '../../lib/format';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Input, Label, Select } from '../ui/Input';
import { RefreshButton } from '../shared/RefreshButton';
import { ReadOnlyField } from '../shared/ReadOnlyField';
import { ConfirmDeleteModal } from '../modals/ConfirmDeleteModal';
import { toLocalizedErrorMessage } from '../../lib/backendErrors';

const ALL_SCOPES: TokenScope[] = ['dav:read', 'dav:write', 'admin'];

export function TokensTab({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<TokenMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<TokenScope[]>(['dav:read', 'dav:write']);
  const [expiresInDays, setExpiresInDays] = useState('');
  const [grants, setGrants] = useState<VolumeGrantInput[]>([]);
  const [grantOwner, setGrantOwner] = useState('');
  const [grantVolume, setGrantVolume] = useState('');
  const [grantScope, setGrantScope] = useState<TokenScope>('dav:read');
  const [saving, setSaving] = useState(false);
  const [lastCreated, setLastCreated] = useState<string | null>(null);
  const [lastRotated, setLastRotated] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<TokenMetadata | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const run = async () => {
      try {
        setTokens(await listTokens());
      } catch (error) {
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToLoadTokens', 'Failed To Load Tokens.'));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [showNotice, reloadKey, t]);

  const refresh = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  const toggleScope = (scope: TokenScope) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const addGrant = () => {
    const owner = grantOwner.trim();
    const volume = grantVolume.trim();
    if (!owner || !volume) return;
    if (grants.some((g) => g.owner.toLowerCase() === owner.toLowerCase() && g.name.toLowerCase() === volume.toLowerCase())) return;
    setGrants((prev) => [...prev, { owner, name: volume, scope: grantScope }]);
    setGrantOwner('');
    setGrantVolume('');
  };

  const removeGrant = (index: number) => {
    setGrants((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scopes.length === 0) {
      showNotice('error', t('tokens.selectAtLeastOneScope', 'Select At Least One Scope.'));
      return;
    }
    const expiry = expiresInDays.trim() === '' ? undefined : Number(expiresInDays);
    if (expiry !== undefined && (!Number.isSafeInteger(expiry) || expiry <= 0)) {
      showNotice('error', t('tokens.invalidExpiry', 'Expiry Must Be A Positive Number Of Days.'));
      return;
    }
    setSaving(true);
    try {
      const created = await createToken(name.trim(), [...scopes], expiry, grants.length > 0 ? grants : undefined);
      setLastCreated(created.token);
      setLastRotated(null);
      setName('');
      setGrants([]);
      showNotice('success', t('tokens.tokenCreated', 'Token Created. Copy It Now — It Will Not Be Shown Again.'));
      setLoading(true);
      setReloadKey((k) => k + 1);
    } catch (error) {
      showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToCreateToken', 'Failed To Create Token.'));
    } finally {
      setSaving(false);
    }
  };

  const rotate = async (tokenId: string) => {
    setRotatingId(tokenId);
    try {
      const rotated = await rotateToken(tokenId);
      setLastRotated(rotated.token);
      setLastCreated(null);
      showNotice('success', t('tokens.tokenRotated', 'Token Rotated. The Old Secret Stopped Working. Copy The New One Now.'));
      setLoading(true);
      setReloadKey((k) => k + 1);
    } catch (error) {
      showNotice('error', toLocalizedErrorMessage(t, error, 'tokens.failedToRotate', 'Failed To Rotate Token.'));
    } finally {
      setRotatingId(null);
    }
  };

  const confirmRevoke = async () => {
    if (!revoking) return;
    try {
      await revokeToken(revoking.tokenId);
      showNotice('success', t('tokens.tokenRevoked', 'Token Revoked.'));
      setLoading(true);
      setReloadKey((k) => k + 1);
    } catch (error) {
      showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToRevokeToken', 'Failed To Revoke Token.'));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('tokens.personalAccessTokens', 'Personal Access Tokens')}</CardTitle>
          <RefreshButton onRefresh={refresh} loading={loading} />
        </CardHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-48">
              <Input
                placeholder={t('tokens.tokenNamePlaceholder', 'Token Name (e.g. laptop)')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="w-32">
              <Input
                placeholder={t('tokens.expiryPlaceholder', 'Expiry (days)')}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              <KeyRound className="h-3.5 w-3.5" />
              {t('tokens.mintToken', 'Mint Token')}
            </Button>
          </div>
          <fieldset>
            <Label>{t('tokens.scopes', 'Scopes (WebDAV)')}</Label>
            <div className="mt-1.5 flex gap-4 flex-wrap">
              {ALL_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="font-mono">{scope}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {t('tokens.scopesHint', 'Reads Need dav:read. Writes Need dav:write. Admin Covers Both.')}
            </p>
          </fieldset>
          <fieldset>
            <Label>{t('tokens.volumeGrants', 'Restrict To Volumes (Optional)')}</Label>
            <div className="mt-1.5 flex gap-2 flex-wrap">
              <div className="w-36">
                <Input placeholder={t('tokens.grantOwner', 'Owner')} value={grantOwner} onChange={(e) => setGrantOwner(e.target.value)} />
              </div>
              <div className="w-36">
                <Input placeholder={t('tokens.grantVolume', 'Volume')} value={grantVolume} onChange={(e) => setGrantVolume(e.target.value)} />
              </div>
              <Select
                aria-label={t('tokens.grantScope', 'Grant Scope')}
                value={grantScope}
                onChange={(e) => setGrantScope(e.target.value as TokenScope)}
              >
                {ALL_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="secondary" size="sm" onClick={addGrant}>
                {t('tokens.addGrant', 'Add')}
              </Button>
            </div>
            {grants.length > 0 && (
              <ul className="mt-2 space-y-1">
                {grants.map((grant, index) => (
                  <li key={`${grant.owner}/${grant.name}`} className="text-sm text-[var(--color-text-secondary)] flex items-center gap-2">
                    <span className="font-mono">
                      {grant.owner}/{grant.name} ({grant.scope})
                    </span>
                    <Button type="button" variant="danger" size="sm" onClick={() => removeGrant(index)}>
                      {t('common.remove', 'Remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {t('tokens.grantsHint', 'Empty Means All Volumes You Can See.')}
            </p>
          </fieldset>
        </form>
        {lastCreated && (
          <div className="mt-4">
            <ReadOnlyField label={t('tokens.newToken', 'New Token (Copy Once)')} value={lastCreated} showCopy />
          </div>
        )}
        {lastRotated && (
          <div className="mt-4">
            <ReadOnlyField label={t('tokens.rotatedToken', 'Rotated Token (Copy Once)')} value={lastRotated} showCopy />
          </div>
        )}
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {tokens.map((token) => (
            <li key={token.tokenId} className="py-3 flex items-center justify-between gap-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="font-medium text-[var(--color-text-primary)] truncate">
                  {token.name}
                  {token.tokenPrefix && <span className="ml-2 font-mono text-xs text-[var(--color-text-muted)]">{token.tokenPrefix}…</span>}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">{formatExpiryTimestamp(token.expiresAt)}</p>
                <p className="mt-1 flex gap-1.5 flex-wrap">
                  {(token.scopes ?? []).map((scope) => (
                    <span
                      key={scope}
                      className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
                    >
                      {scope}
                    </span>
                  ))}
                </p>
                {(token.volumeGrants ?? []).length > 0 && (
                  <p className="mt-1 flex gap-1.5 flex-wrap">
                    {(token.volumeGrants ?? []).map((grant) => (
                      <span
                        key={grant.fullName}
                        className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
                      >
                        {grant.fullName}:{grant.scope}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="secondary" size="sm" loading={rotatingId === token.tokenId} onClick={() => void rotate(token.tokenId)}>
                  {t('tokens.rotate', 'Rotate')}
                </Button>
                <Button variant="danger" size="sm" onClick={() => setRevoking(token)}>
                  {t('tokens.revoke', 'Revoke')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {tokens.length === 0 && !loading && (
          <p className="text-sm text-[var(--color-text-muted)] mt-4">{t('tokens.noTokens', 'No Tokens Yet.')}</p>
        )}
      </Card>

      {revoking && (
        <ConfirmDeleteModal
          title={t('tokens.revokeToken', 'Revoke Token')}
          displayName={revoking.name}
          onConfirm={() => void confirmRevoke()}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
