'use client';

import { FlagsTab } from '@/components/admin/tabs';
import { useAdminConsole } from '@/components/admin/shared';

export default function AdminFlagsPage() {
  const { setPageError } = useAdminConsole();
  return <FlagsTab onError={setPageError} />;
}
