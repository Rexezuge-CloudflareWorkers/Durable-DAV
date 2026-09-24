import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FolderArchive, Plus } from 'lucide-react';
import type { Volume } from '../types';
import { toLocalizedErrorMessage } from '../lib/backendErrors';
import { listMyVolumes } from '../services/volumeService';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { AppPage } from '../components/layout/AppPage';
import { PageHeaderCard } from '../components/layout/PageHeaderCard';
import { EmptyState } from '../components/layout/PageState';
import { VisibilityBadge } from '../components/ui/Badge';
import { ReadOnlyField } from '../components/shared/ReadOnlyField';
import { RefreshButton } from '../components/shared/RefreshButton';

export function DashboardView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [loading, setLoading] = useState(true);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const run = async () => {
      try {
        setVolumes(await listMyVolumes());
      } catch (error) {
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToLoadVolumes', 'Failed To Load Volumes.'));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [showNotice, reloadKey, t]);

  const refresh = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  return (
    <AppPage>
      <PageHeaderCard
        title={t('dashboard.title', 'Dashboard')}
        actions={
          <>
            <RefreshButton onRefresh={refresh} loading={loading} />
            <Button variant="primary" size="sm" onClick={() => void navigate('/new')}>
              <Plus className="h-3.5 w-3.5" />
              {t('dashboard.new', 'New')}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.connect', 'Connect')}</CardTitle>
        </CardHeader>
        <div className="space-y-3">
          <ReadOnlyField label={t('dashboard.mountAnyVolume', 'Mount Any Volume')} value={`${globalThis.location?.origin ?? ''}/<owner>/<volume>/`} showCopy />
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('dashboard.connectHelp', 'Private Volumes And All Writes Use A Personal Access Token As The Password: {{example}}. Public Volumes Allow Anonymous Reads. Manage Tokens In Settings.', {
              example: 'https://<owner>:<PAT>@host/owner/volume/',
            })}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.volumes', 'Volumes')}</CardTitle>
          <span className="text-sm text-[var(--color-text-muted)]">{volumes.length}</span>
        </CardHeader>
        {!loading && volumes.length === 0 ? (
          <EmptyState
            icon={<FolderArchive className="h-6 w-6 text-[var(--color-text-muted)]" />}
            message={t('dashboard.empty', 'No Volumes Yet. Create One To Get Started.')}
          />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {volumes.map((v) => (
              <li key={v.fullName} className="py-3 flex items-center justify-between gap-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link to={`/${v.owner}/${v.name}`} className="font-medium text-[var(--color-accent)] hover:underline truncate">
                    {v.fullName}
                  </Link>
                </div>
                <VisibilityBadge isPrivate={v.isPrivate} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppPage>
  );
}
