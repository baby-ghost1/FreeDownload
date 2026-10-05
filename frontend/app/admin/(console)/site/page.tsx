'use client';

import { SiteTab } from '@/components/admin/tabs';
import { useAdminConsole } from '@/components/admin/shared';

export default function AdminSitePage() {
  const { setPageError } = useAdminConsole();
  return <SiteTab onError={setPageError} />;
}
