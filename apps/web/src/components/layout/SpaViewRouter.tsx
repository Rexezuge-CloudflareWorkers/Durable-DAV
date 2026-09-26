import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CurrentUser } from '../../types';
import Unauthorized from './Unauthorized';
import { Card } from '../ui/Card';
import { AppPage } from './AppPage';
import { LandingView } from '../../views/LandingView';
import { DashboardView } from '../../views/DashboardView';
import { NewVolumeView } from '../../views/NewVolumeView';
import { VolumeView } from '../../views/VolumeView';
import { ProfileView } from '../../views/ProfileView';
import { SettingsView } from '../../views/SettingsView';

/**
Shown while `/user/me` is still in flight.
*/
function AuthPending() {
  return (
    <div className="min-h-screen bg-[var(--color-surface-base)] flex items-center justify-center">
      <div className="h-10 w-10 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
    </div>
  );
}

interface SpaViewRouterProps {
  user: CurrentUser | null;
  setUser: (user: CurrentUser) => void;
  authorized: boolean | null;
  showNotice: (type: 'success' | 'error', text: string) => void;
  defaultOwner: string;
  language: string;
  onLanguageChange: (lng: string) => void;
  languageDisabled?: boolean;
}

/**
 * Route switch extracted from `SpaApp` so the shell stays a thin composition
 * root. Props are the already-composed hook slices; no data fetching here.
 */
function SpaViewRouter({
  user,
  setUser,
  authorized,
  showNotice,
  defaultOwner,
  language,
  onLanguageChange,
  languageDisabled,
}: SpaViewRouterProps) {
  const { t } = useTranslation();
  // Auth is still resolving — volume routes render speculatively with public
  // data, but owner-gated routes stay on a spinner to avoid flashing
  // Landing/Unauthorized to signed-in users.
  if (authorized === null) {
    return (
      <Routes>
        <Route path="/:owner/:volume" element={<VolumeView showNotice={showNotice} />} />
        <Route path="/:username" element={<ProfileView showNotice={showNotice} />} />
        {/*
          `/new` and `/settings` are single-segment paths, so they do not match
          `/:owner/:volume` and used to fall through to `/:username` — which
          fired `GET /users/new` and rendered "Profile Not Found" for a moment
          on every cold load before flipping to the real view.
        */}
        <Route path="/new" element={<AuthPending />} />
        <Route path="/settings" element={<AuthPending />} />
        <Route path="*" element={<AuthPending />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/" element={user ? <DashboardView showNotice={showNotice} /> : <LandingView />} />
      <Route
        path="/new"
        element={
          user ? (
            <NewVolumeView defaultOwner={defaultOwner} showNotice={showNotice} />
          ) : (
            <AppPage>
              <Unauthorized message={t('errors.signInToCreate', 'Sign In To Create Volumes.')} />
            </AppPage>
          )
        }
      />
      <Route path="/:owner/:volume" element={<VolumeView showNotice={showNotice} />} />
      <Route path="/:username" element={<ProfileView showNotice={showNotice} />} />
      <Route
        path="/settings"
        element={
          user ? (
            <SettingsView
              user={user}
              setUser={setUser}
              showNotice={showNotice}
              language={language}
              onLanguageChange={onLanguageChange}
              languageDisabled={languageDisabled}
            />
          ) : (
            <AppPage>
              <Unauthorized message={t('errors.signInToManage', 'Sign In To Manage Settings.')} />
            </AppPage>
          )
        }
      />
      <Route
        path="*"
        element={
          <AppPage>
            <Card>
              <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('errors.pageNotFound', 'Page Not Found')}</h1>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {t('errors.pageNotFoundDescription', 'The Page You Requested Does Not Exist.')}
              </p>
            </Card>
          </AppPage>
        }
      />
    </Routes>
  );
}

export { SpaViewRouter };
export type { SpaViewRouterProps };
