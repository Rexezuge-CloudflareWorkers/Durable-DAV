import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DavEntry } from '../../types';
import { toLocalizedErrorMessage } from '../../lib/backendErrors';
import { listDirectory } from '../../services/davClient';

// Data-fetching slice for the file browser (why: `VolumeView` mixed routing,
// fetching, and mutations; isolating the query keeps the view a thin
// composition root like `SpaApp`).
function useVolumeFiles(owner: string, volume: string, path: string, authorized: boolean | null) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<DavEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
        setNotice({ type: 'error', text: toLocalizedErrorMessage(t, error, 'errors.failedToLoadFiles', 'Failed To Load Files.') });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [owner, volume, path, reloadKey, authorized, t]);

  const refresh = useCallback(() => {
    setStatus('loading');
    setReloadKey((k) => k + 1);
  }, []);

  const crumbs = path === '' ? [] : path.split('/');

  return { entries, status, refresh, crumbs, notice, consumeNotice: () => setNotice(null) };
}

export { useVolumeFiles };
