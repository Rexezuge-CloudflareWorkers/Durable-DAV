import { useTranslation } from 'react-i18next';
import type { DavEntry } from '../../types';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ModalShell } from '@rexezuge/web';
import { ConfirmDeleteModal } from '../../components/modals/ConfirmDeleteModal';

function VolumeFileModals({
  busy,
  mkdirOpen,
  mkdirName,
  renaming,
  renameValue,
  deleting,
  preview,
  onCloseMkdir,
  onMkdirName,
  onMkdirSubmit,
  onRenameValue,
  onRenameSubmit,
  onCloseRename,
  onConfirmDelete,
  onCancelDelete,
  onClosePreview,
}: {
  busy: boolean;
  mkdirOpen: boolean;
  mkdirName: string;
  renaming: DavEntry | null;
  renameValue: string;
  deleting: DavEntry | null;
  preview: { entry: DavEntry; text: string | null } | null;
  onCloseMkdir: () => void;
  onMkdirName: (v: string) => void;
  onMkdirSubmit: (e: React.FormEvent) => void;
  onRenameValue: (v: string) => void;
  onRenameSubmit: (e: React.FormEvent) => void;
  onCloseRename: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClosePreview: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {mkdirOpen && (
        <ModalShell onClose={onCloseMkdir} ariaLabel={t('files.newFolder', 'New Folder')} closeLabel={t('common.close', 'Close')}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('files.newFolder', 'New Folder')}</h2>
          </div>
          <div className="overflow-y-auto p-5 space-y-2.5 max-h-[calc(82vh-4rem)]">
            <form onSubmit={onMkdirSubmit} className="space-y-3">
              <Input
                placeholder={t('files.folderNamePlaceholder', 'photos')}
                value={mkdirName}
                onChange={(e) => onMkdirName(e.target.value)}
                autoFocus
              />
              <Button type="submit" variant="primary" loading={busy} className="w-full">
                {t('common.create', 'Create')}
              </Button>
            </form>
          </div>
        </ModalShell>
      )}
      {renaming && (
        <ModalShell onClose={onCloseRename} ariaLabel={t('files.rename', 'Rename')} closeLabel={t('common.close', 'Close')}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('files.rename', 'Rename')}</h2>
          </div>
          <div className="overflow-y-auto p-5 space-y-2.5 max-h-[calc(82vh-4rem)]">
            <form onSubmit={onRenameSubmit} className="space-y-3">
              <Input value={renameValue} onChange={(e) => onRenameValue(e.target.value)} autoFocus />
              <Button type="submit" variant="primary" loading={busy} className="w-full">
                {t('common.saveChanges', 'Save Changes')}
              </Button>
            </form>
          </div>
        </ModalShell>
      )}
      {deleting && (
        <ConfirmDeleteModal
          title={t('files.deleteEntry', 'Delete Entry')}
          displayName={deleting.name}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}
      {preview && (
        <ModalShell onClose={onClosePreview} widthClass="w-full max-w-2xl max-h-[82vh] overflow-hidden mx-4" ariaLabel={preview.entry.name} closeLabel={t('common.close', 'Close')}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] truncate">{preview.entry.name}</h2>
          </div>
          <div className="overflow-y-auto p-5 space-y-2.5 max-h-[calc(82vh-4rem)]">
            {preview.text === null ? (
              <p className="text-sm text-[var(--color-text-muted)]">{t('files.binaryPreview', 'Binary File — Not Previewed.')}</p>
            ) : preview.text === '' ? (
              <p className="text-sm text-[var(--color-text-muted)]">{t('files.emptyFile', 'Empty File.')}</p>
            ) : (
              <pre className="text-xs whitespace-pre-wrap break-words text-[var(--color-text-secondary)]">{preview.text}</pre>
            )}
          </div>
        </ModalShell>
      )}
    </>
  );
}

export { VolumeFileModals };
