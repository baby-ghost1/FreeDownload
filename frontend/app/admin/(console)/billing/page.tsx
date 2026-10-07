'use client';

import { BillingTab } from '@/components/admin/tabs';
import { useAdminConsole } from '@/components/admin/shared';

export default function AdminBillingPage() {
  const { setPageError } = useAdminConsole();
  return <BillingTab onError={setPageError} />;
}
