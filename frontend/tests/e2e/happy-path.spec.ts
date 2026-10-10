import { expect, test } from '@playwright/test';

import { ApiMock } from './api-mock';

test('happy path: paste link, analyze, pick format, watch progress, get download', async ({
  page,
}) => {
  const api = new ApiMock(page);
  await api.install();

  // Landing renders a hero entry point.
  await page.goto('/');
  await expect(page.getByTestId('hero-url')).toBeVisible();

  // Hand the link to the download flow.
  await page.getByTestId('hero-url').fill('https://media.test/watch?v=abc');
  await page.getByTestId('hero-go').click();

  // Analysis shows the media with selectable formats.
  await expect(page).toHaveURL(/\/download\?url=/);
  await expect(page.getByTestId('analysis-title')).toHaveText('Big Buck Bunny');
  await expect(page.getByTestId('format-1080p')).toBeVisible();
  await expect(page.getByTestId('format-mp3')).toBeVisible();

  // Choosing a format creates the job and lands on its status page.
  await page.getByTestId('format-1080p').click();
  await expect(page).toHaveURL(/\/downloads\/job-1$/);

  // Polling walks queued → processing → completed, then the signed link appears.
  await expect(page.getByTestId('job-status')).toHaveText('Done', { timeout: 20_000 });
  await expect(page.getByTestId('result-card')).toBeVisible();
  const href = await page.getByTestId('download-link').getAttribute('href');
  expect(href).toContain('cdn.test/files/job-1.mp4');
  await expect(page.getByTestId('download-link')).toHaveText(/Download file/);

  // The play button opens the inline preview; the X closes it again.
  await page.getByTestId('play-preview').click();
  await expect(page.getByTestId('video-preview')).toBeVisible();
  await expect(page.getByTestId('video-player')).toBeVisible();
  await page.getByTestId('video-preview-close').click();
  await expect(page.getByTestId('video-preview')).toHaveCount(0);
});

test('my downloads lists finished jobs', async ({ page }) => {
  const api = new ApiMock(page);
  await api.install();

  await page.goto('/downloads');
  const item = page.getByTestId('history-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('media.test/watch?v=abc');

  await item.click();
  await expect(page).toHaveURL(/\/downloads\/job-1$/);
  await expect(page.getByTestId('job-status')).toHaveText('Done', { timeout: 20_000 });
});
