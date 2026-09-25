import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Plus, Upload } from 'lucide-react';
import type { VolumeDetail } from '../types';
import { parentDavPath, stripSlashes } from '../lib/davXml';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { ContextBar } from '../components/layout/ContextBar';
import { AppPage } from '../components/layout/AppPage';
import { RefreshButton } from '../components/shared/RefreshButton';
import { VolumeSettingsTab } from '../components/volume/VolumeSettingsTab';
import { VisibilityBadge } from '../components/ui/Badge';
import { useVolumeFiles } from './volume/useVolumeFiles';
import { useVolumeMutations } from './volume/useVolumeMutations';
import { VolumeFileList } from './volume/VolumeFileList';
import { VolumeFileModals } from './volume/VolumeFileModals';

function cleanPath(raw: string | null): string {
  return stripSlashes(raw ?? '');
}

// Thin composition root: routing + hook slices + presentational children.
function VolumeView({
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
  const fileRef = useRef<HTMLInputElement | null>(null);

  const { entries, status, refresh, crumbs, notice, consumeNotice } = useVolumeFiles(owner, volume, path, authorized);
  const mutations = useVolumeMutations(owner, volume, path, showNotice, refresh);

  useEffect(() => {
    if (!notice) {
    	return;
    }

    showNotice(notice.type, notice.text);
    consumeNotice();
  }, [notice, showNotice, consumeNotice]);

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

  return (
    <div>
      <ContextBar
        crumb={
          <span className="text-xl font-semibold text-[var(--color-text-primary)] truncate">
            <Link to={`/${owner}/${volume}`} onClick={() => { setTab('files'); setPath(''); }} className="hover:text-[var(--color-accent)]">
              {owner}/{volume}
            </Link>
            {activeTab === 'files' &&
              crumbs.map((segment, index) => (
                <span key={`${segment}-${index}`}>
                  <ChevronRight className="inline h-4 w-4 mx-1 text-[var(--color-text-muted)]" />
                  <button type="button" className="hover:text-[var(--color-accent)]" onClick={() => setPath(crumbs.slice(0, index + 1).join('/'))}>
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
          <VolumeSettingsTab owner={owner} volume={volume} showNotice={showNotice} onUpdated={setVolumeDetail} onDeleted={() => void navigate('/')} />
        </AppPage>
      ) : (
        <AppPage>
          <Card>
            <CardHeader>
              <CardTitle>{path === '' ? t('files.root', 'Files') : (path.split('/').pop() ?? path)}</CardTitle>
              <div className="flex gap-2 flex-wrap">
                <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { void mutations.doUpload(e.target.files); if (fileRef.current) fileRef.current.value = ''; }} />
                <Button variant="secondary" size="sm" disabled={mutations.busy} onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" />
                  {t('files.upload', 'Upload')}
                </Button>
                <Button variant="secondary" size="sm" disabled={mutations.busy} onClick={() => mutations.setMkdirOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('files.newFolder', 'New Folder')}
                </Button>
              </div>
            </CardHeader>
            {path !== '' && (
              <button type="button" className="text-sm text-[var(--color-accent)] hover:underline mb-3" onClick={() => setPath(parentDavPath(path) ?? '')}>
                {t('files.up', 'Up To Parent Folder')}
              </button>
            )}
            <VolumeFileList
              owner={owner}
              volume={volume}
              entries={entries}
              status={status}
              busy={mutations.busy}
              onPreview={(e) => void mutations.openPreview(e, setPath)}
              onRename={(e) => { mutations.setRenaming(e); mutations.setRenameValue(e.name); }}
              onDuplicate={(e) => void mutations.doDuplicate(e)}
              onDelete={(e) => mutations.setDeleting(e)}
            />
          </Card>
          <VolumeFileModals
            busy={mutations.busy}
            mkdirOpen={mutations.mkdirOpen}
            mkdirName={mutations.mkdirName}
            renaming={mutations.renaming}
            renameValue={mutations.renameValue}
            deleting={mutations.deleting}
            preview={mutations.preview}
            onCloseMkdir={() => mutations.setMkdirOpen(false)}
            onMkdirName={mutations.setMkdirName}
            onMkdirSubmit={mutations.doMkdir}
            onRenameValue={mutations.setRenameValue}
            onRenameSubmit={mutations.doRename}
            onCloseRename={() => mutations.setRenaming(null)}
            onConfirmDelete={() => void mutations.doDelete()}
            onCancelDelete={() => mutations.setDeleting(null)}
            onClosePreview={() => mutations.setPreview(null)}
          />
        </AppPage>
      )}
    </div>
  );
}

export { VolumeView };
