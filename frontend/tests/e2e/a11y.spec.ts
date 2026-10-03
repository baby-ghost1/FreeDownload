import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

import { ApiMock } from './api-mock';
import { unauthorized } from './fixtures';

/**
 * WCAG 2.1 A/AA audit (Phase 8) — axe runs against the real rendered DOM
 * with every API call mocked, so violations in actual markup fail the gate.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoViolations(page: Page, url: string, label: string): Promise<void> {
  await page.goto(url);
  // Mocked APIs answer instantly; a fixed settle beats `networkidle`, which
  // never settles on the job-detail page (it polls forever by design).
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 25).map((n) => ({
      target: n.target,
      html: n.html.slice(0, 200),
      summary: n.failureSummary?.slice(0, 400),
    })),
  }));
  expect(summary, `${label}: ${url}`).toEqual([]);
}

test('public marketing and auth pages have no WCAG A/AA violations', async ({ page }) => {
  const api = new ApiMock(page);
  await api.install();

  const routes: Array<[string, string]> = [
    ['/', 'landing'],
    ['/login', 'login'],
    ['/register', 'register'],
    ['/forgot-password', 'forgot password'],
    ['/reset-password?token=e2e', 'reset password'],
    ['/verify-email?token=e2e', 'verify email'],
    ['/download', 'download form'],
    ['/terms', 'terms'],
    ['/privacy', 'privacy'],
  ];
  for (const [url, label] of routes) {
    await expectNoViolations(page, url, label);
  }
});

test('signed-in account and job pages have no WCAG A/AA violations', async ({ page }) => {
  const api = new ApiMock(page, { signedIn: true });
  await api.install();

  const routes: Array<[string, string]> = [
    ['/account', 'account'],
    ['/downloads', 'history'],
    ['/downloads/job-1', 'job detail'],
  ];
  for (const [url, label] of routes) {
    await expectNoViolations(page, url, label);
  }
});

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('admin console has no WCAG A/AA violations', async ({ page }) => {
  let signedIn = false;
  let mfaOk = false;

  await page.route('http://localhost:4000/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '');

    if (path === '/me') return json(route, unauthorized, 401);
    if (path === '/admin/auth/me') {
      if (!signedIn) return json(route, unauthorized, 401);
      return json(route, {
        admin: { id: 'admin-1', email: 'owner@example.com', role: 'owner', active: true },
        mfaOk,
      });
    }
    if (path === '/admin/auth/login' && method === 'POST') {
      signedIn = true;
      return json(route, {
        admin: { id: 'admin-1', email: 'owner@example.com', role: 'owner', active: true },
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
    if (path === '/admin/overview') {
      return json(route, {
        jobs: { total: 12, last24h: 3, byStatus: { queued: 2, completed: 10 } },
        users: { total: 5, active: 4, suspended: 1 },
        sources: { total: 1, enabled: 1 },
        auditsLast24h: 7,
      });
    }
    return json(
      route,
      { error: { code: 'NOT_FOUND', message: 'not mocked', requestId: 'e2e' } },
      404,
    );
  });

  // Same enrollment dance as admin.spec.ts, then audit both screens.
  await page.goto('/admin');
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByTestId('admin-login-submit').click();
  await page.getByTestId('mfa-setup-start').click();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByTestId('mfa-setup-submit').click();
  await expect(page.getByTestId('admin-app')).toBeVisible();

  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target),
    })),
    'admin dashboard',
  ).toEqual([]);
});
