'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api/client';
import type { Admin } from '@/lib/api/types';

export function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function useTabData<T>(
  loader: () => Promise<T>,
  onError: (msg: string | null) => void,
  deps: unknown[] = [],
): {
  data: T | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    loader()
      .then((r) => {
        if (live) {
          setData(r);
          onError(null);
        }
      })
      .catch((err: unknown) => {
        if (live) onError(message(err, 'Could not load this panel.'));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loader rebuilt per render; deps drives refetch
  }, [nonce, ...deps]);

  return { data, reload: () => setNonce((n) => n + 1) };
}

type AdminConsoleContextValue = {
  admin: Admin | null;
  setPageError: (msg: string | null) => void;
};

export const AdminConsoleContext = createContext<AdminConsoleContextValue>({
  admin: null,
  setPageError: () => {},
});

export function useAdminConsole(): AdminConsoleContextValue {
  return useContext(AdminConsoleContext);
}
