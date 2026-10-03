'use client';

import { SessionProvider } from '@/lib/session';

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
