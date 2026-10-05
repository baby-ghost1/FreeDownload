'use client';

import { LimitsTab } from '@/components/admin/tabs';
import { useAdminConsole } from '@/components/admin/shared';

export default function AdminLimitsPage() {
  const { setPageError } = useAdminConsole();
  return <LimitsTab onError={setPageError} />;
}
