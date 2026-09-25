import { useTranslation } from 'react-i18next';
import { Download, File as FileIcon, Folder as FolderIcon, Pencil, Trash2 } from 'lucide-react';
import type { DavEntry } from '../../types';
import { formatBytes } from '../../lib/format';
import { downloadUrl } from '../../services/davClient';
import { EmptyState, LoadingSpinner } from '../../components/layout/PageState';

function VolumeFileList({
  owner,
  volume,
  entries,
  status,
  busy,
  onPreview,
  onRename,
  onDuplicate,
  onDelete,
}: {
  owner: string;
  volume: string;
  entries: DavEntry[];
  status: 'loading' | 'ready' | 'missing';
  busy: boolean;
  onPreview: (entry: DavEntry) => void;
  onRename: (entry: DavEntry) => void;
  onDuplicate: (entry: DavEntry) => void;
  onDelete: (entry: DavEntry) => void;
}) {
  const { t } = useTranslation();
  if (status === 'loading') return <LoadingSpinner label={t('files.loadingFiles', 'Loading Files…')} />;
  if (status === 'missing' && entries.length === 0) {
    return <EmptyState message={t('files.notFound', 'This Folder Does Not Exist Or You Do Not Have Access.')} />;
  }
  if (entries.length === 0) {
    return <EmptyState message={t('files.emptyFolder', 'Empty Folder. Upload A File Or Create A Subfolder.')} />;
  }
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {entries.map((entry) => (
        <li key={entry.path} className="py-2.5 flex items-center gap-3 first:pt-0 last:pb-0">
          <span className="shrink-0">
            {entry.isCollection ? (
              <FolderIcon className="h-4 w-4 text-[var(--color-accent)]" />
            ) : (
              <FileIcon className="h-4 w-4 text-[var(--color-text-muted)]" />
            )}
          </span>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onPreview(entry)}>
            <span className="block font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)] truncate">
              {entry.name}
              {entry.isCollection ? '/' : ''}
            </span>
            <span className="block text-xs text-[var(--color-text-muted)] truncate">
              {entry.isCollection ? t('files.folder', 'Folder') : formatBytes(entry.size)}
              {entry.lastModified ? ` · ${entry.lastModified}` : ''}
            </span>
          </button>
          {!entry.isCollection && (
            <a
              href={downloadUrl(owner, volume, entry.path)}
              download={entry.name}
              aria-label={t('files.download', 'Download')}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
            >
              <Download className="h-4 w-4" />
            </a>
          )}
          <button
            type="button"
            aria-label={t('files.rename', 'Rename')}
            disabled={busy}
            onClick={() => onRename(entry)}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t('files.duplicate', 'Duplicate')}
            disabled={busy}
            onClick={() => onDuplicate(entry)}
            className="hidden sm:block px-2 py-1.5 rounded-lg text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
          >
            {t('files.duplicate', 'Duplicate')}
          </button>
          <button
            type="button"
            aria-label={t('common.delete', 'Delete')}
            disabled={busy}
            onClick={() => onDelete(entry)}
            className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-error-text)] hover:bg-[var(--color-surface-3)]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export { VolumeFileList };
