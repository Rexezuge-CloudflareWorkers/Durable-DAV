import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, ModalShell } from '@rexezuge/web';

/**
 * The themed delete confirmation: the kit's `ModalShell` frame (Escape
 * handling, corner close) with this app's chrome inside it.
 *
 * Deliberately not the kit's `ConfirmDeleteModal`, which takes the same
 * message/label props but renders two bare `<button>`s — no tone, no icon, no
 * focus ring — so adopting it would drop the `ghost`/`danger` pair out of the
 * app's most destructive dialogs. That is the family's reading too: all five
 * repos that own this dialog keep their own skin over the kit's frame, and the
 * kit's version is imported by none of them. The kit's own docs describe its
 * `message`-as-prop contract as the point (no translation dependency), which is
 * exactly what a *frame* should offer; the skin is this file's whole job.
 *
 * A caller reaches for `TypeToConfirmModal` (kit) when the name must be retyped
 * — the bucket Danger Zone — and this one when a single confirm is the gate.
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
