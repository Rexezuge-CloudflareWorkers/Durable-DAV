import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '@rexezuge/web';
import { Button } from '../ui/Button';

/**
 * Styled delete confirmation kept local: the kit's `ConfirmDeleteModal` takes
 * the same message/label props but renders unstyled buttons, while this app's
 * destructive dialogs use the themed `ghost`/`danger` pair. The frame is the
 * kit's (`ModalShell`, with its Escape handling and corner close); the chrome
 * stays this app's. Revisit when the kit styles its own.
 */
export function ConfirmDeleteModal({
  title,
  displayName,
  onConfirm,
  onCancel,
}: {
  title: string;
  displayName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell onClose={onCancel} widthClass="w-80" ariaLabel={title} closeLabel={t('common.close', 'Close')}>
      <div className="p-6">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-error-bg)] mb-4 mx-auto">
          <AlertTriangle className="h-5 w-5 text-[var(--color-error-text)]" />
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] text-center mb-6">
          {t('common.deleteConfirm', 'Delete {{name}}? This Cannot Be Undone.', { name: displayName })}
        </p>
        <div className="flex gap-3">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
          >
            {t('common.delete', 'Delete')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
