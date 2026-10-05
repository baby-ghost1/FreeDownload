import { expect, test, type Route } from '@playwright/test';

import { unauthorized } from './fixtures';

const ADMIN = {
  id: 'admin-1',
  email: 'owner@example.com',
  role: 'owner',
  active: true,
};

const SOURCE = {
  id: 'src-1',
  slug: 'generic',
  name: 'Generic',
  adapterKey: 'generic',
  enabled: true,
  mode: 'active',
  allowedFormats: [],
  maxFileSizeMb: null,
  requiresAuth: false,
  priority: 100,
  healthStatus: 'unknown',
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const OVERVIEW = {
  jobs: { total: 12, last24h: 3, byStatus: { queued: 2, completed: 10 } },
  users: { total: 5, active: 4, suspended: 1 },
  sources: { total: 1, enabled: 1 },
  auditsLast24h: 7,
};

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

test('admin signs in and toggles a source at runtime', async ({ page }) => {
  let signedIn = false;
  let sourceEnabled = true;

  await page.route('http://localhost:4000/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '');

    if (path === '/me') return json(route, unauthorized, 401);

    if (path === '/admin/auth/me') {
      if (!signedIn) return json(route, unauthorized, 401);
      return json(route, { admin: ADMIN, mfaOk: false });
    }
    if (path === '/admin/auth/login' && method === 'POST') {
      signedIn = true;
      return json(route, {
        admin: ADMIN,
        csrfToken: 'csrf-e2e',
        mfaEnrolled: false,
        mfaOk: false,
      });
    }
    if (path === '/admin/auth/logout' && method === 'POST') {
      signedIn = false;
      return json(route, { ok: true });
    }
    if (path === '/admin/overview') return json(route, OVERVIEW);
    if (path === '/admin/sources' && method === 'GET') {
      return json(route, { data: [{ ...SOURCE, enabled: sourceEnabled }] });
    }
    if (path.startsWith('/admin/sources/') && method === 'PATCH') {
      const body = request.postDataJSON() as { enabled?: boolean };
      if (body.enabled !== undefined) sourceEnabled = body.enabled;
      return json(route, { ...SOURCE, enabled: sourceEnabled });
    }
    return json(
      route,
      { error: { code: 'NOT_FOUND', message: 'not mocked', requestId: 'e2e' } },
      404,
    );
  });

  await page.goto('/admin/login');
  await expect(page.getByTestId('admin-login')).toBeVisible();

  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByTestId('admin-login-submit').click();

  // Dashboard - no second factor: ADMIN_MFA_REQUIRED is off, so the login
  // lands straight on the console.
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId('admin-app')).toBeVisible();
  await expect(page.getByTestId('admin-total-jobs')).toContainText('12');

  // Runtime source toggle - the Phase 6 exit criterion, surfaced in the UI.
  await page.getByTestId('admin-tab-sources').click();
  await expect(page).toHaveURL(/\/admin\/sources$/);
  await expect(page.getByTestId('source-row-generic')).toContainText('Enabled');
  await page.getByTestId('source-toggle-generic').click();
  await expect(page.getByTestId('source-row-generic')).toContainText('Disabled');
  await expect(page.getByTestId('source-toggle-generic')).toHaveText('Enable');

  // And back on.
  await page.getByTestId('source-toggle-generic').click();
  await expect(page.getByTestId('source-row-generic')).toContainText('Enabled');
});
