'use client';

import { OverviewTab } from '@/components/admin/tabs';
import { useAdminConsole } from '@/components/admin/shared';

export default function AdminOverviewPage() {
  const { setPageError } = useAdminConsole();
  return <OverviewTab onError={setPageError} />;
}
