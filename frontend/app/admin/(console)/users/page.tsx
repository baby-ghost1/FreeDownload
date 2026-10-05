'use client';

import { UsersTab } from '@/components/admin/tabs';
import { useAdminConsole } from '@/components/admin/shared';

export default function AdminUsersPage() {
  const { setPageError } = useAdminConsole();
  return <UsersTab onError={setPageError} />;
}
