import { useTranslation } from 'react-i18next';

export function NoticeBar({ notice }: { notice: { type: 'success' | 'error'; text: string } }) {
  const { t } = useTranslation();
  const statusLabel = notice.type === 'success' ? t('common.success', 'Success') : t('common.error', 'Error');
  return (
    <div
      // `role="status"` implies `aria-live="polite"`, so a failed bucket delete
      // or credential revoke was announced at the same priority as a background
      // update and a screen-reader user might never hear it. Errors are
      // assertive.
      role={notice.type === 'error' ? 'alert' : 'status'}
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-slide-down px-5 py-3 rounded-xl shadow-xl bg-[var(--color-surface-2)] border border-[var(--color-border-muted)] max-w-[calc(100vw-2rem)]"
    >
      <span className="sr-only">{statusLabel}: </span>
      <span className={notice.type === 'success' ? 'text-[var(--color-success-text)]' : 'text-[var(--color-error-text)]'}>
        {notice.text}
      </span>
    </div>
  );
}
