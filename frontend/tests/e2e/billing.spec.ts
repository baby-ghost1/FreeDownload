import { expect, test } from '@playwright/test';

import { ApiMock } from './api-mock';
import { businessSubscription, proSubscription } from './fixtures';

test('free plan shows limits; UPI modal files an upgrade request', async ({ page }) => {
  const api = new ApiMock(page, { signedIn: true });
  await api.install();

  await page.goto('/account');
  await expect(page.getByTestId('billing-plan')).toContainText('Free');
  await expect(page.getByTestId('billing-status')).toHaveText('active');
  await expect(page.getByTestId('billing-limits')).toContainText('25 downloads/day');
  await expect(page.getByTestId('billing-upgrade-pro')).toBeVisible();

  await page.getByTestId('billing-upgrade-pro').click();
  await expect(page.getByTestId('upgrade-title')).toContainText('Pro');
  await expect(page.getByTestId('upgrade-request')).toBeVisible();

  await page.getByTestId('upgrade-request').click();
  await expect(page.getByTestId('upgrade-request-item')).toHaveCount(1);
  await expect(page.getByTestId('upgrade-request-status')).toHaveText('pending');
});

test('downgrades a provider-less paid plan back to free', async ({ page }) => {
  const api = new ApiMock(page, { signedIn: true, subscription: businessSubscription });
  await api.install();

  await page.goto('/account');
  await expect(page.getByTestId('billing-plan')).toContainText('Business');
  await expect(page.getByTestId('billing-downgrade')).toBeVisible();

  await page.getByTestId('billing-downgrade').click();
  await expect(page.getByTestId('billing-plan')).toContainText('Free');
  await expect(page.getByTestId('billing-upgrade-pro')).toBeVisible();
});

test('cancels a paid plan and reports the canceled status', async ({ page }) => {
  const api = new ApiMock(page, { signedIn: true, subscription: proSubscription });
  await api.install();

  await page.goto('/account');
  await page.getByTestId('billing-cancel').click();
  await expect(page.getByTestId('billing-status')).toHaveText('canceled');
  await expect(page.getByTestId('billing-plan')).toContainText('Free');
});

test('creates an API key, shows it once, reads usage and revokes', async ({ page }) => {
  const api = new ApiMock(page, { signedIn: true });
  await api.install();

  await page.goto('/account');
  await expect(page.getByTestId('api-key-item')).toHaveCount(1);

  await page.getByTestId('api-key-name').fill('ci');
  await page.getByTestId('api-key-create').click();
  await expect(page.getByTestId('api-key-raw')).toContainText('fd_live_');
  await expect(page.getByTestId('api-key-item')).toHaveCount(2);

  await page.getByTestId('api-key-usage-load').first().click();
  await expect(page.getByTestId('api-key-usage').first()).toContainText('42 requests');

  await page.getByTestId('api-key-revoke').first().click();
  await expect(page.getByTestId('api-key-item')).toHaveCount(2);
  await expect(page.getByTestId('api-key-revoke')).toHaveCount(1);
});

test('ad slot renders only when the ads flag is enabled', async ({ page }) => {
  const hidden = new ApiMock(page);
  await hidden.install();
  await page.goto('/');
  await expect(page.getByTestId('hero-url')).toBeVisible();
  await expect(page.getByTestId('ad-slot')).toHaveCount(0);

  const shown = new ApiMock(page, { flags: { ads: true } });
  await shown.install();
  await page.goto('/');
  await expect(page.getByTestId('ad-slot')).toBeVisible();
});
