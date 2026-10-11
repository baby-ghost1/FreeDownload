import { expect, test } from '@playwright/test';

import { ApiMock } from './api-mock';
import { jobFixture, jobResult } from './fixtures';

test('earlier ready downloads stay stacked below until saved', async ({ page }) => {
  const api = new ApiMock(page);
  await api.install();

  // Two finished jobs: the one this page shows (job-1) plus an older ready one.
  await page.route('http://localhost:4000/api/v1/downloads?limit=10', (route) =>
    route.fulfill({
      json: {
        data: [
          jobFixture({ id: 'job-1', status: 'completed', progress: 100 }),
          jobFixture({ id: 'job-0', status: 'completed', progress: 100 }),
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route('http://localhost:4000/api/v1/downloads/job-0/result', (route) =>
    route.fulfill({
      json: {
        ...jobResult,
        url: 'https://cdn.test/files/job-0.mp4?sig=zero',
        downloadUrl: 'https://cdn.test/files/job-0.mp4?dl=1&sig=zero',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    }),
  );
  // A fake CDN answering download URLs with an attachment header, so the
  // cross-origin <a download> click does not navigate the page away.
  await page.route(/dl=1/, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-disposition': 'attachment; filename="file.mp4"' },
      body: Buffer.from('x'),
    }),
  );

  await page.goto('/downloads/job-1');
  await expect(page.getByTestId('job-status')).toHaveText('Done', { timeout: 20_000 });
  await expect(page.getByTestId('result-card')).toBeVisible();

  // The older job stacks below the current one.
  const stacked = page.getByTestId('stacked-result-job-0');
  await expect(stacked).toBeVisible();
  const currentBox = await page.getByTestId('result-card').boundingBox();
  const stackedBox = await stacked.boundingBox();
  if (!currentBox || !stackedBox) throw new Error('missing bounding boxes');
  expect(stackedBox.y).toBeGreaterThan(currentBox.y);

  // Play opens the shared preview with THAT job's file.
  await page.getByTestId('stacked-play-job-0').click();
  await expect(page.getByTestId('video-preview')).toBeVisible();
  expect(await page.getByTestId('video-player').getAttribute('src')).toContain('job-0.mp4');
  await page.getByTestId('video-preview-close').click();
  await expect(page.getByTestId('video-preview')).toHaveCount(0);

  // Saving it removes just that card; the current download stays put.
  await page.getByTestId('stacked-download-job-0').click();
  await expect(stacked).toHaveCount(0);
  await expect(page.getByTestId('result-card')).toBeVisible();
});
