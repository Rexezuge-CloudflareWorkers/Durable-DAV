import { useTranslation } from 'react-i18next';
import type { CurrentUser } from '../../types';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { ReadOnlyField } from '../shared/ReadOnlyField';

export function ProfileSettingsCard({ user }: { user: CurrentUser; setUser: (user: CurrentUser) => void; showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.profile', 'Profile')}</CardTitle>
      </CardHeader>
      <div className="space-y-3">
        <ReadOnlyField label={t('settings.email', 'Email')} value={user.email} />
        <ReadOnlyField label={t('settings.username', 'Username')} value={user.username ?? ''} />
      </div>
    </Card>
  );
}
