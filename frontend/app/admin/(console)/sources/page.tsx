'use client';

import { SourcesTab } from '@/components/admin/tabs';
import { useAdminConsole } from '@/components/admin/shared';

export default function AdminSourcesPage() {
  const { setPageError } = useAdminConsole();
  return <SourcesTab onError={setPageError} />;
}
