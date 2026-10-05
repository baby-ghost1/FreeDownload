'use client';

import { ProfileTab } from '@/components/admin/tabs';
import { useAdminConsole } from '@/components/admin/shared';

export default function AdminProfilePage() {
  const { setPageError } = useAdminConsole();
  return <ProfileTab onError={setPageError} />;
}
