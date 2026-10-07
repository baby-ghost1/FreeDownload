'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/lib/api/client';
import { login as loginRequest, logout as logoutRequest, me } from '@/lib/api/endpoints';
import type { SessionPayload, User } from '@/lib/api/types';

interface SessionState {
  user: User | null;
  /** True until the first `/me` probe settles. */
  loading: boolean;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  applySession: (session: SessionPayload) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await me());
    } catch (err) {
      // 401 = anonymous; anything else keeps the last known state.
      if (err instanceof ApiError && err.status === 401) setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time /me probe; all setState happens after the network response settles
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('fd:session-expired', onExpired);
    return () => window.removeEventListener('fd:session-expired', onExpired);
  }, []);

  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      void refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [user, refresh]);

  const signIn = useCallback(async (input: { email: string; password: string }) => {
    const session = await loginRequest(input);
    setUser(session.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setUser(null);
    }
  }, []);

  const applySession = useCallback((session: SessionPayload) => setUser(session.user), []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, refresh, applySession }),
    [user, loading, signIn, signOut, refresh, applySession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
