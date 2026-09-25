import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Download, File as FileIcon, Folder as FolderIcon, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { DavEntry, VolumeDetail } from '../types';
import { toLocalizedErrorMessage } from '../lib/backendErrors';
import { formatBytes } from '../lib/format';
import { parentDavPath, stripSlashes } from '../lib/davXml';
import { copyEntry, createDirectory, deleteEntry, downloadUrl, listDirectory, moveEntry, uploadFile } from '../services/davClient';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { ContextBar } from '../components/layout/ContextBar';
import { AppPage } from '../components/layout/AppPage';
import { EmptyState, LoadingSpinner } from '../components/layout/PageState';
import { RefreshButton } from '../components/shared/RefreshButton';
import { ModalShell, ModalHeader, ModalBody } from '../components/modals/ModalShell';
import { ConfirmDeleteModal } from '../components/modals/ConfirmDeleteModal';
import { VolumeSettingsTab } from '../components/volume/VolumeSettingsTab';
import { VisibilityBadge } from '../components/ui/Badge';

function cleanPath(raw: string | null): string {
  return stripSlashes(raw ?? '');
}

export function VolumeView({
  authorized,
  showNotice,
}: {
  authorized: boolean | null;
  showNotice: (type: 'success' | 'error', text: string) => void;
}) {
  const { owner = '', volume = '' } = useParams<{ owner: string; volume: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const path = cleanPath(params.get('path'));
  const activeTab = params.get('tab') === 'settings' ? 'settings' : 'files';
  const [volumeDetail, setVolumeDetail] = useState<VolumeDetail | null>(null);
  const [entries, setEntries] = useState<DavEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [renaming, setRenaming] = useState<DavEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<DavEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ entry: DavEntry; text: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const setPath = useCallback(
    (next: string) => {
      const nextParams: Record<string, string> = {};
      if (next !== '') nextParams['path'] = next;
      if (activeTab === 'settings') nextParams['tab'] = 'settings';
      setParams(nextParams, { replace: false });
    },
    [setParams, activeTab],
  );

  const setTab = useCallback(
    (tab: 'files' | 'settings') => {
      const nextParams: Record<string, string> = {};
      if (path !== '') nextParams['path'] = path;
      if (tab === 'settings') nextParams['tab'] = 'settings';
      setParams(nextParams, { replace: false });
    },
    [setParams, path],
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const rows = await listDirectory(owner, volume, path);
        if (cancelled) return;
        setEntries(rows);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('missing');
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToLoadFiles', 'Failed To Load Files.'));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [owner, volume, path, reloadKey, authorized, showNotice, t]);

  const refresh = () => {
    setStatus('loading');
    setReloadKey((k) => k + 1);
  };

  const crumbs = path === '' ? [] : path.split('/');

  const doMkdir = async (e: React.FormEvent) => {
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
  };

  const doUpload = async (files: FileList | null) => {
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
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doDelete = async () => {
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
  };

  const doRename = async (e: React.FormEvent) => {
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
  };

  const doDuplicate = async (entry: DavEntry) => {
    const target = `${entry.path}-copy`;
    setBusy(true);
    try {
      await copyEntry(owner, volume, entry.path, target);
      showNotice('success', t('files.duplicated', 'Duplicated.'));
      refresh();
    } catch (error) {
      showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToDuplicate', 'Failed To Duplicate.'));
    } finally {
      setBusy(false);
    }
  };

  const openPreview = async (entry: DavEntry) => {
    if (entry.isCollection) {
      setPath(entry.path);
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
  };

  return (
    <div>
      <ContextBar
        crumb={
          <span className="text-xl font-semibold text-[var(--color-text-primary)] truncate">
            <Link
              to={`/${owner}/${volume}`}
              onClick={() => {
                setTab('files');
                setPath('');
              }}
              className="hover:text-[var(--color-accent)]"
            >
              {owner}/{volume}
            </Link>
            {activeTab === 'files' &&
              crumbs.map((segment, index) => (
                <span key={`${segment}-${index}`}>
                  <ChevronRight className="inline h-4 w-4 mx-1 text-[var(--color-text-muted)]" />
                  <button
                    type="button"
                    className="hover:text-[var(--color-accent)]"
                    onClick={() => setPath(crumbs.slice(0, index + 1).join('/'))}
                  >
                    {segment}
                  </button>
                </span>
              ))}
            {volumeDetail && (
              <span className="ml-2 align-middle">
                <VisibilityBadge isPrivate={volumeDetail.isPrivate} />
              </span>
            )}
          </span>
        }
        actions={<RefreshButton onRefresh={refresh} loading={status === 'loading'} />}
      />
      <div className="max-w-7xl mx-auto px-6 pt-4 flex gap-2">
        <Button variant={activeTab === 'files' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('files')}>
          {t('volumes.filesTab', 'Files')}
        </Button>
        <Button variant={activeTab === 'settings' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('settings')}>
          {t('volumes.settingsTab', 'Settings')}
        </Button>
      </div>
      {activeTab === 'settings' ? (
        <AppPage>
          <VolumeSettingsTab
            owner={owner}
            volume={volume}
            showNotice={showNotice}
            onUpdated={setVolumeDetail}
            onDeleted={() => void navigate('/')}
          />
        </AppPage>
      ) : (
        <AppPage>
        <Card>
          <CardHeader>
            <CardTitle>
              {path === '' ? t('files.root', 'Files') : (path.split('/').pop() ?? path)}
            </CardTitle>
            <div className="flex gap-2 flex-wrap">
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void doUpload(e.target.files)} />
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                {t('files.upload', 'Upload')}
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMkdirOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                {t('files.newFolder', 'New Folder')}
              </Button>
            </div>
          </CardHeader>
          {path !== '' && (
            <button
              type="button"
              className="text-sm text-[var(--color-accent)] hover:underline mb-3"
              onClick={() => setPath(parentDavPath(path) ?? '')}
            >
              {t('files.up', 'Up To Parent Folder')}
            </button>
          )}
          {status === 'loading' ? (
            <LoadingSpinner label={t('files.loadingFiles', 'Loading Files…')} />
          ) : status === 'missing' && entries.length === 0 ? (
            <EmptyState message={t('files.notFound', 'This Folder Does Not Exist Or You Do Not Have Access.')} />
          ) : entries.length === 0 ? (
            <EmptyState message={t('files.emptyFolder', 'Empty Folder. Upload A File Or Create A Subfolder.')} />
          ) : (
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
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openPreview(entry)}>
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
                    onClick={() => {
                      setRenaming(entry);
                      setRenameValue(entry.name);
                    }}
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('files.duplicate', 'Duplicate')}
                    disabled={busy}
                    onClick={() => void doDuplicate(entry)}
                    className="hidden sm:block px-2 py-1.5 rounded-lg text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
                  >
                    {t('files.duplicate', 'Duplicate')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('common.delete', 'Delete')}
                    disabled={busy}
                    onClick={() => setDeleting(entry)}
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-error-text)] hover:bg-[var(--color-surface-3)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {mkdirOpen && (
          <ModalShell onClose={() => setMkdirOpen(false)} ariaLabel={t('files.newFolder', 'New Folder')}>
            <ModalHeader title={t('files.newFolder', 'New Folder')} onClose={() => setMkdirOpen(false)} />
            <ModalBody>
              <form onSubmit={doMkdir} className="space-y-3">
                <Input
                  placeholder={t('files.folderNamePlaceholder', 'photos')}
                  value={mkdirName}
                  onChange={(e) => setMkdirName(e.target.value)}
                  autoFocus
                />
                <Button type="submit" variant="primary" loading={busy} className="w-full">
                  {t('common.create', 'Create')}
                </Button>
              </form>
            </ModalBody>
          </ModalShell>
        )}

        {renaming && (
          <ModalShell onClose={() => setRenaming(null)} ariaLabel={t('files.rename', 'Rename')}>
            <ModalHeader title={t('files.rename', 'Rename')} onClose={() => setRenaming(null)} />
            <ModalBody>
              <form onSubmit={doRename} className="space-y-3">
                <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
                <Button type="submit" variant="primary" loading={busy} className="w-full">
                  {t('common.saveChanges', 'Save Changes')}
                </Button>
              </form>
            </ModalBody>
          </ModalShell>
        )}

        {deleting && (
          <ConfirmDeleteModal
            title={t('files.deleteEntry', 'Delete Entry')}
            displayName={deleting.name}
            onConfirm={() => void doDelete()}
            onCancel={() => setDeleting(null)}
          />
        )}

        {preview && (
          <ModalShell
            onClose={() => setPreview(null)}
            widthClass="w-full max-w-2xl max-h-[82vh] overflow-hidden mx-4"
            ariaLabel={preview.entry.name}
          >
            <ModalHeader title={preview.entry.name} onClose={() => setPreview(null)} />
            <ModalBody>
              {preview.text === null ? (
                <p className="text-sm text-[var(--color-text-muted)]">{t('files.binaryPreview', 'Binary File — Not Previewed.')}</p>
              ) : preview.text === '' ? (
                <p className="text-sm text-[var(--color-text-muted)]">{t('files.emptyFile', 'Empty File.')}</p>
              ) : (
                <pre className="text-xs whitespace-pre-wrap break-words text-[var(--color-text-secondary)]">{preview.text}</pre>
              )}
            </ModalBody>
          </ModalShell>
        )}
        </AppPage>
      )}
    </div>
  );
}
