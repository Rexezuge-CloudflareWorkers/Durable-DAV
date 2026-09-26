import { FolderArchive, Lock, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { AppPage } from '../components/layout/AppPage';
import { ZERO_TRUST_AUTHENTICATION_PATH } from '../lib/constants';

function signIn() {
  globalThis.location.assign(ZERO_TRUST_AUTHENTICATION_PATH);
}

export function LandingView() {
  const { t } = useTranslation();
  return (
    <AppPage variant="hero">
      <div className="text-center max-w-2xl mx-auto animate-fade-in-up">
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          {t('landing.title', 'Self-Hosted WebDAV On Cloudflare Workers')}
        </h1>
        <p className="mt-4 text-[var(--color-text-secondary)]">
          {t(
            'landing.subtitle',
            'Volumes Backed By Durable Objects, Served Over WebDAV. Public Volumes Allow Anonymous Reads; Private Volumes Stay Protected.',
          )}
        </p>
        <div className="mt-8">
          <Button variant="primary" size="lg" onClick={signIn}>
            {t('landing.signIn', 'Sign In With Cloudflare Access')}
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mt-12 animate-stagger-1">
        <Card>
          <FolderArchive className="h-5 w-5 text-[var(--color-accent)] mb-3" />
          <h2 className="font-semibold text-[var(--color-text-primary)] mb-1">{t('landing.webdav', 'WebDAV Class 1+2')}</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('landing.webdavDescription', 'Mount, Sync, And Edit With Any WebDAV Client.')}
          </p>
        </Card>
        <Card>
          <Zap className="h-5 w-5 text-[var(--color-accent)] mb-3" />
          <h2 className="font-semibold text-[var(--color-text-primary)] mb-1">{t('landing.edgeStorage', 'Edge Storage')}</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('landing.edgeStorageDescription', 'One Durable Object Per Volume, SQLite-Backed.')}
          </p>
        </Card>
        <Card>
          <Lock className="h-5 w-5 text-[var(--color-accent)] mb-3" />
          <h2 className="font-semibold text-[var(--color-text-primary)] mb-1">{t('landing.accessControl', 'Access Control')}</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('landing.accessControlDescription', 'Personal Access Tokens For WebDAV; Cloudflare Access For The Web UI.')}
          </p>
        </Card>
      </div>
    </AppPage>
  );
}
