import { FolderArchive, Lock, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppPage, Button, Card, ZERO_TRUST_AUTHENTICATION_PATH } from '@rexezuge/web';

function signIn() {
  location.assign(ZERO_TRUST_AUTHENTICATION_PATH);
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
            'Buckets Backed By Durable Objects, Served Over WebDAV. Each Bucket Has Its Own Credentials; Private Buckets Stay Protected.',
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
            {t('landing.edgeStorageDescription', 'One Durable Object Per Bucket, SQLite-Backed.')}
          </p>
        </Card>
        <Card>
          <Lock className="h-5 w-5 text-[var(--color-accent)] mb-3" />
          <h2 className="font-semibold text-[var(--color-text-primary)] mb-1">{t('landing.accessControl', 'Access Control')}</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('landing.accessControlDescription', 'Per-Bucket Credentials For WebDAV; Cloudflare Access For The Web UI.')}
          </p>
        </Card>
      </div>
    </AppPage>
  );
}
