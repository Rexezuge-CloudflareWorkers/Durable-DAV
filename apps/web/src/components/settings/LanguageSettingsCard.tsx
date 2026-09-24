import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '../shared/LanguageSelector';
import { Card, CardHeader, CardTitle } from '../ui/Card';

export function LanguageSettingsCard({
  language,
  onLanguageChange,
  disabled,
}: {
  language: string;
  onLanguageChange: (lng: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.preferences', 'Preferences')}</CardTitle>
      </CardHeader>
      <div className="space-y-1.5">
        <span id="user-language-label" className="block text-sm text-[var(--color-text-secondary)]">
          {t('settings.language', 'Language')}
        </span>
        <LanguageSelector value={language} onChange={onLanguageChange} disabled={disabled} />
        <p className="text-xs text-[var(--color-text-muted)]">
          {t('settings.languageDescription', 'Choose Your Preferred Display Language.')}
        </p>
      </div>
    </Card>
  );
}
