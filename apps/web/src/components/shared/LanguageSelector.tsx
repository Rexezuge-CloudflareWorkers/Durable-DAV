import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import { Select } from '../ui/Input';

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
  pt: 'Português',
  pl: 'Polski',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ko: '한국어',
};

export function LanguageSelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (lng: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Select
      aria-label={t('settings.selectLanguage', 'Select Language')}
      aria-labelledby="user-language-label"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full"
    >
      {SUPPORTED_LANGUAGES.map((lng) => (
        <option key={lng} value={lng}>
          {LANGUAGE_LABELS[lng] ?? lng}
        </option>
      ))}
    </Select>
  );
}
