import { expect, test } from '@playwright/test';

import { ApiMock } from './api-mock';

test('sign in shows the session; sign out clears it', async ({ page }) => {
  const api = new ApiMock(page);
  await api.install();

  await page.goto('/');
  await page.getByTestId('sign-in').click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByTestId('login-submit').click();

  // Back on the landing page with the session rendered in the header.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('session-email')).toHaveText('Ada');

  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('sign-in')).toBeVisible();
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
  await expect(page.getByTestId('session-email')).toHaveText('Grace');
});
