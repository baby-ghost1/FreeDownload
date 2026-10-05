import { expect, test } from '@playwright/test';

import { ApiMock } from './api-mock';

test('sign in form works', async ({ page }) => {
  const api = new ApiMock(page);
  await api.install();

  await page.goto('/login');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByTestId('login-submit').click();

  // Landed signed in: the account page renders the billing section.
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account');
  await expect(page.getByTestId('billing-plan')).toContainText('Free');
});

test('register form submits and lands signed in', async ({ page }) => {
  const api = new ApiMock(page);
  await api.install();

  await page.goto('/register');
  await page.getByLabel('Email').fill('grace@example.com');
  await page.getByLabel('Display name (optional)').fill('Grace');
  await page.getByLabel('Password').fill('password123');
  await page.getByTestId('register-submit').click();

  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account');
  await expect(page.getByTestId('billing-plan')).toContainText('Free');
});
