import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserRound } from 'lucide-react';
import type { UserProfile } from '../types';
import { loadProfile } from '../services/profileService';
import { toLocalizedErrorMessage } from '../lib/backendErrors';
import { Card } from '../components/ui/Card';
import { ContextBar } from '../components/layout/ContextBar';
import { LoadingSpinner } from '../components/layout/PageState';

export function ProfileView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { username = '' } = useParams<{ username: string }>();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Reset per fetch: navigating to another profile re-ran this effect while
      // `status` was still `ready`, leaving the previous user's card on screen.
      setStatus('loading');
      try {
        const data = await loadProfile(username);
        if (cancelled) return;
        setProfile(data);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('missing');
        showNotice('error', toLocalizedErrorMessage(t, error, 'errors.failedToLoadProfile', 'Failed To Load Profile.'));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [username, showNotice, t]);

  if (status === 'loading') {
    return <LoadingSpinner label={t('profile.loadingProfile', 'Loading Profile…')} />;
  }

  if (status === 'missing' || !profile) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Card>
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('profile.notFound', 'Profile Not Found')}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('profile.notFoundDescription', 'This User Does Not Exist.')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <ContextBar
        crumb={
          <span className="text-xl font-semibold text-[var(--color-text-primary)] truncate">
            {profile.username}
            <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">{t('profile.user', 'User')}</span>
          </span>
        }
      />
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-4">
        <Card className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-surface-3)] shrink-0">
            <UserRound className="h-6 w-6 text-[var(--color-text-secondary)]" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)] truncate">{profile.username}</h1>
          </div>
        </Card>
      </div>
    </div>
  );
}
