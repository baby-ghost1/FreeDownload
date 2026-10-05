'use client';

import { SessionsTab } from '@/components/admin/tabs';
import { useAdminConsole } from '@/components/admin/shared';

export default function AdminSessionsPage() {
  const { setPageError } = useAdminConsole();
  return <SessionsTab onError={setPageError} />;
}
