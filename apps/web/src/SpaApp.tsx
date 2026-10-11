import { useCallback } from 'react';
import { useMatch } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NoticeBar, useNotice } from '@rexezuge/web';
import { Header } from './components/layout/Header';
import { SpaViewRouter } from './components/layout/SpaViewRouter';
import { useCurrentUser } from './hooks/useCurrentUser';
import { useSpaLanguage } from './hooks/useSpaLanguage';

function TopHeader({ userEmail, username }: { userEmail: string | null; username?: string | null }) {
  // The marketing/global header is root-only: every other route renders a
  // contextual `ContextBar` instead, so the top anchor never moves pages.
  const isRootPage = useMatch('/') !== null;
  return isRootPage ? <Header userEmail={userEmail} username={username} /> : null;
}

export default function SpaApp() {
  const { t } = useTranslation();
  const { notice, showNotice } = useNotice();
  // `useCallback` here is belt-and-braces, not the fix: `useCurrentUser` reads
  // `onError` through a ref so an unstable callback cannot re-arm its fetch.
  // Stabilising it anyway keeps this component from modelling the trap.
  const handleAccountError = useCallback(
    (message: string) => {
      showNotice('error', `Could Not Load Your Account: ${message}`);
    },
    [showNotice],
  );
  const { user, setUser, authorized } = useCurrentUser(handleAccountError);
  const { language, languageStatus, languagePending, handleLanguageChange } = useSpaLanguage({
    user,
    showNotice,
    setUser,
  });

  const ownerFromEmail = user ? user.email.split('@', 1)[0] : '';
  const defaultOwner = user?.username?.trim() ? user.username : ownerFromEmail;

  return (
    <div className="min-h-screen bg-[var(--color-surface-base)] text-[var(--color-text-primary)]">
      <TopHeader userEmail={user?.email ?? null} username={user?.username ?? null} />
      <NoticeBar notice={notice} statusLabels={{ success: t('common.success', 'Success'), error: t('common.error', 'Error') }} />

      <SpaViewRouter
        user={user}
        setUser={setUser}
        authorized={authorized}
        showNotice={showNotice}
        defaultOwner={defaultOwner}
        language={languageStatus === 'error' ? 'unknown' : language}
        onLanguageChange={handleLanguageChange}
        languageDisabled={languagePending || languageStatus !== 'ready'}
      />
    </div>
  );
}
