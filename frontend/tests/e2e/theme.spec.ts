import { expect, test } from '@playwright/test';

import { ApiMock } from './api-mock';

test('dark theme applies instantly and survives a reload', async ({ page }) => {
  const api = new ApiMock(page);
  await api.install();

  await page.goto('/');
  const toggle = page.getByRole('button', { name: /Switch theme/ });
  await expect(toggle).toHaveAttribute('data-theme-choice', 'system');

  // Cycle: system → light → dark → system.
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-theme-choice', 'light');
  await expect(page.locator('html')).toHaveClass(/light/);

  await toggle.click();
  await expect(toggle).toHaveAttribute('data-theme-choice', 'dark');
  await expect(page.locator('html')).toHaveClass(/dark/);

  // The pre-paint script restores the choice before hydration.
  await page.reload();
  await expect(page.getByRole('button', { name: /Switch theme/ })).toHaveAttribute(
    'data-theme-choice',
    'dark',
  );
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('core layout renders without horizontal overflow', async ({ page }) => {
  const api = new ApiMock(page);
  await api.install();

  await page.goto('/');
  await expect(page.getByTestId('hero-go')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
