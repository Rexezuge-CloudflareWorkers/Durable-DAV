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
    let cancelled = false;
    // Monotonic request id: `refresh()` can start a second request while the
    // first is in flight, and without sequencing the slower first response
    // would land last and overwrite the fresher list with stale data. Also
    // guards the setState-after-unmount that the `cancelled` flag prevents.
    let requestId = 0;
    const run = async () => {
      requestId += 1;
      const current = requestId;
      try {
        const rows = await listMyVolumes();
        if (cancelled || current !== requestId) return;
        setVolumes(rows);
      } catch (error) {
        if (cancelled || current !== requestId) return;
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToLoadVolumes', 'Failed To Load Volumes.'));
      } finally {
        if (!cancelled && current === requestId) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
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
            {t('dashboard.connectHelp', 'Each Bucket Has Its Own Credentials. Open A Bucket, Go To Settings, Create A Credential, Then Connect With: {{example}}.', {
              example: 'https://<username>:<password>@host/owner/volume/',
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
