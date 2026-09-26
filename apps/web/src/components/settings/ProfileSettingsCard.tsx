import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentUser } from '../../types';
import { renameCurrentUsername, loadCurrentUser } from '../../services/userService';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Input, Label } from '../ui/Input';
import { toLocalizedErrorMessage } from '../../lib/backendErrors';

export function ProfileSettingsCard({
  user,
  setUser,
  showNotice,
}: {
  user: CurrentUser;
  setUser: (user: CurrentUser) => void;
  showNotice: (type: 'success' | 'error', text: string) => void;
}) {
  const { t } = useTranslation();
  const [newUsername, setNewUsername] = useState(user.username ?? '');
  const [saving, setSaving] = useState(false);

  const trimmedUsername = newUsername.trim();
  const dirtyUsername = trimmedUsername !== '' && trimmedUsername !== (user.username ?? '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirtyUsername) return;
    setSaving(true);
    try {
      const updated = await renameCurrentUsername(trimmedUsername);
      setUser(updated);
      setNewUsername(updated.username ?? '');
      showNotice('success', t('settings.settingsUpdated', 'Profile Settings Updated.'));
    } catch (error) {
      try {
        const current = await loadCurrentUser();
        setUser(current);
        setNewUsername(current.username ?? '');
      } catch {
        // Ignore refresh failures — the error notice below is authoritative.
      }
      const message = error instanceof Error ? error.message : '';
      showNotice(
        'error',
        message.toLowerCase().includes('reserved')
          ? t('settings.usernameReserved', 'This Name Is Reserved For System Use.')
          : toLocalizedErrorMessage(t, error, 'settings.failedToUpdate', 'Failed To Update Profile.'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.profile', 'Profile')}</CardTitle>
      </CardHeader>
      <dl className="space-y-2 text-sm mb-4">
        <div className="flex gap-2">
          <dt className="text-[var(--color-text-muted)] w-20 shrink-0">{t('settings.email', 'Email')}</dt>
          <dd className="text-[var(--color-text-primary)] truncate">{user.email}</dd>
        </div>
      </dl>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="user-username">{t('settings.username', 'Username')}</Label>
          <Input
            id="user-username"
            placeholder={t('settings.usernamePlaceholder', 'your-username')}
            value={newUsername}
            maxLength={39}
            onChange={(e) => setNewUsername(e.target.value)}
          />
          <p className="text-xs text-[var(--color-text-muted)]">
            {t('settings.renameHint', 'Renaming Changes All Bucket URLs Under Your Account.')}
          </p>
        </div>
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!dirtyUsername}>
          {t('common.saveChanges', 'Save Changes')}
        </Button>
      </form>
    </Card>
  );
}
