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

test('admin signs in, completes MFA and toggles a source at runtime', async ({ page }) => {
  let signedIn = false;
  let mfaOk = false;
  let sourceEnabled = true;

  await page.route('http://localhost:4000/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '');

    if (path === '/me') return json(route, unauthorized, 401);

    if (path === '/admin/auth/me') {
      if (!signedIn) return json(route, unauthorized, 401);
      return json(route, { admin: ADMIN, mfaOk });
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
    if (path === '/admin/auth/mfa/setup' && method === 'POST') {
      return json(route, {
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl:
          'otpauth://totp/FreeDownload:owner@example.com?secret=JBSWY3DPEHPK3PXP&issuer=FreeDownload',
      });
    }
    if (path === '/admin/auth/mfa/complete' && method === 'POST') {
      mfaOk = true;
      return json(route, { ok: true });
    }
    if (path === '/admin/auth/logout' && method === 'POST') {
      signedIn = false;
      mfaOk = false;
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

  await page.goto('/admin');
  await expect(page.getByTestId('admin-login')).toBeVisible();

  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByTestId('admin-login-submit').click();

  // MFA gate: no admin data renders until enrollment confirms a code.
  await expect(page.getByTestId('admin-mfa')).toBeVisible();
  await expect(page.getByTestId('admin-app')).toHaveCount(0);

  await page.getByTestId('mfa-setup-start').click();
  await expect(page.getByTestId('mfa-secret')).toBeVisible();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByTestId('mfa-setup-submit').click();

  // Dashboard.
  await expect(page.getByTestId('admin-app')).toBeVisible();
  await expect(page.getByTestId('admin-total-jobs')).toContainText('12');

  // Runtime source toggle — the Phase 6 exit criterion, surfaced in the UI.
  await page.getByTestId('admin-tab-sources').click();
  await expect(page.getByTestId('source-row-generic')).toContainText('Enabled');
  await page.getByTestId('source-toggle-generic').click();
  await expect(page.getByTestId('source-row-generic')).toContainText('Disabled');
  await expect(page.getByTestId('source-toggle-generic')).toHaveText('Enable');

  // And back on.
  await page.getByTestId('source-toggle-generic').click();
  await expect(page.getByTestId('source-row-generic')).toContainText('Enabled');
});
