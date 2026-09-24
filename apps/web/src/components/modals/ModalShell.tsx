import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function ModalShell({
  onClose,
  children,
  widthClass = 'w-80',
  ariaLabel,
}: {
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
  ariaLabel?: string;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="fixed inset-0 bg-black/60 animate-backdrop-in" />
      <div
        className={`relative bg-[var(--color-surface-1)] border border-[var(--color-border-muted)] rounded-2xl shadow-2xl animate-fade-in ${widthClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({ title, onClose, actions }: { title: string; onClose: () => void; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
      <div className="flex items-center gap-2">
        {actions}
        <button
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors p-1 rounded-lg hover:bg-[var(--color-surface-3)]"
          onClick={onClose}
          aria-label={t('common.close', 'Close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function ModalBody({ children }: { children: ReactNode }) {
  return <div className="overflow-y-auto p-5 space-y-2.5 max-h-[calc(82vh-4rem)]">{children}</div>;
}
