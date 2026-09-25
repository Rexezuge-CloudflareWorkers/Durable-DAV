import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DavEntry } from '../../types';
import { toLocalizedErrorMessage } from '../../lib/backendErrors';
import { parentDavPath, stripSlashes } from '../../lib/davXml';
import { copyEntry, createDirectory, deleteEntry, downloadUrl, moveEntry, uploadFile } from '../../services/davClient';

type NoticeFn = (type: 'success' | 'error', text: string) => void;

// Mutation slice for file operations (Command pattern: one async action per
// user intent; the view only wires buttons to these commands).
function useVolumeMutations(owner: string, volume: string, path: string, showNotice: NoticeFn, refresh: () => void) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [renaming, setRenaming] = useState<DavEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<DavEntry | null>(null);
  const [preview, setPreview] = useState<{ entry: DavEntry; text: string | null } | null>(null);

  const doMkdir = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const leaf = stripSlashes(mkdirName.trim());
      if (!leaf || leaf.includes('/')) {
        showNotice('error', t('files.invalidFolderName', 'Enter A Single Folder Name.'));
        return;
      }
      setBusy(true);
      try {
        await createDirectory(owner, volume, path === '' ? leaf : `${path}/${leaf}`);
        setMkdirOpen(false);
        setMkdirName('');
        showNotice('success', t('files.folderCreated', 'Folder Created.'));
        refresh();
      } catch (error) {
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToCreateFolder', 'Failed To Create Folder.'));
      } finally {
        setBusy(false);
      }
    },
    [mkdirName, owner, volume, path, refresh, showNotice, t],
  );

  const doUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setBusy(true);
      try {
        for (const file of Array.from(files)) {
          const target = path === '' ? file.name : `${path}/${file.name}`;
          await uploadFile(owner, volume, target, file);
        }
        showNotice('success', t('files.uploaded', 'Upload Complete.'));
        refresh();
      } catch (error) {
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToUpload', 'Failed To Upload File.'));
      } finally {
        setBusy(false);
      }
    },
    [owner, volume, path, refresh, showNotice, t],
  );

  const doDelete = useCallback(async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteEntry(owner, volume, deleting.path);
      setDeleting(null);
      showNotice('success', t('files.deleted', 'Deleted.'));
      refresh();
    } catch (error) {
      showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToDelete', 'Failed To Delete.'));
    } finally {
      setBusy(false);
    }
  }, [deleting, owner, volume, refresh, showNotice, t]);

  const doRename = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!renaming) return;
      const leaf = stripSlashes(renameValue.trim());
      if (!leaf || leaf.includes('/')) {
        showNotice('error', t('files.invalidName', 'Enter A Single File Or Folder Name.'));
        return;
      }
      const parent = parentDavPath(renaming.path) ?? '';
      const target = parent === '' ? leaf : `${parent}/${leaf}`;
      if (target === renaming.path) {
        setRenaming(null);
        return;
      }
      setBusy(true);
      try {
        await moveEntry(owner, volume, renaming.path, target);
        setRenaming(null);
        showNotice('success', t('files.renamed', 'Renamed.'));
        refresh();
      } catch (error) {
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToRename', 'Failed To Rename.'));
      } finally {
        setBusy(false);
      }
    },
    [renaming, renameValue, owner, volume, refresh, showNotice, t],
  );

  const doDuplicate = useCallback(
    async (entry: DavEntry) => {
      setBusy(true);
      try {
        await copyEntry(owner, volume, entry.path, `${entry.path}-copy`);
        showNotice('success', t('files.duplicated', 'Duplicated.'));
        refresh();
      } catch (error) {
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToDuplicate', 'Failed To Duplicate.'));
      } finally {
        setBusy(false);
      }
    },
    [owner, volume, refresh, showNotice, t],
  );

  const openPreview = useCallback(
    async (entry: DavEntry, openPath: (p: string) => void) => {
      if (entry.isCollection) {
        openPath(entry.path);
        return;
      }
      try {
        const response = await fetch(downloadUrl(owner, volume, entry.path));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if ((blob.type.startsWith('text/') || blob.size < 65_536) && blob.size < 1_048_576) {
          const text = await blob.text().catch(() => null);
          setPreview({ entry, text });
        } else {
          globalThis.open(downloadUrl(owner, volume, entry.path), '_blank', 'noopener');
        }
      } catch {
        globalThis.open(downloadUrl(owner, volume, entry.path), '_blank', 'noopener');
      }
    },
    [owner, volume],
  );

  return {
    busy,
    mkdirOpen,
    setMkdirOpen,
    mkdirName,
    setMkdirName,
    renaming,
    setRenaming,
    renameValue,
    setRenameValue,
    deleting,
    setDeleting,
    preview,
    setPreview,
    doMkdir,
    doUpload,
    doDelete,
    doRename,
    doDuplicate,
    openPreview,
  };
}

export { useVolumeMutations };
