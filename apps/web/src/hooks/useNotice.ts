import { useCallback, useRef, useState } from 'react';
import { NOTICE_TIMEOUT_MS } from '../lib/constants';

export interface Notice {
  type: 'success' | 'error';
  text: string;
}

export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const showNotice = useCallback((type: 'success' | 'error', text: string) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setNotice({ type, text });
    timerRef.current = setTimeout(() => {
      setNotice(null);
      timerRef.current = null;
    }, NOTICE_TIMEOUT_MS);
  }, []);

  return { notice, showNotice };
}
