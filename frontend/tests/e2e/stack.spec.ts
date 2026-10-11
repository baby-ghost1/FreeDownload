import { expect, test } from '@playwright/test';

import { ApiMock } from './api-mock';
import { jobFixture, jobResult } from './fixtures';

test('stacked cards keep their own platform theme and re-download until expiry', async ({
  page,
}) => {
  const api = new ApiMock(page);
  await api.install();

  // Current job is Instagram; the older stacked one is Facebook, so the two
  // cards must NOT share a theme. The single-job fetch drives the page
  // wrapper's data-platform, so it needs the Instagram URL too.
  await page.route('http://localhost:4000/api/v1/downloads/job-1', (route) =>
    route.fulfill({
      json: jobFixture({
        id: 'job-1',
        status: 'completed',
        progress: 100,
        url: 'https://www.instagram.com/reel/abc/',
        requestedFormat: '1080p',
        targetContainer: 'mp4',
        completedAt: '2026-10-03T12:05:00.000Z',
      }),
    }),
  );
  await page.route('http://localhost:4000/api/v1/downloads?limit=10', (route) =>
    route.fulfill({
      json: {
        data: [
          jobFixture({
            id: 'job-1',
            status: 'completed',
            progress: 100,
            url: 'https://www.instagram.com/reel/abc/',
          }),
          jobFixture({
            id: 'job-0',
            status: 'completed',
            progress: 100,
            url: 'https://www.facebook.com/watch/?v=123',
          }),
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

  // The older job stacks below the current one, and keeps ITS OWN theme even
  // though the page wrapper is tinted for the current (Instagram) job.
  const stacked = page.getByTestId('stacked-result-job-0');
  await expect(stacked).toBeVisible();
  await expect(page.locator('[data-platform="instagram"]').first()).toBeVisible();
  await expect(stacked).toHaveAttribute('data-platform', 'facebook');
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

  // First save flips the button to "Downloaded" but the card STAYS (expiry is
  // the only thing that clears it), so it can be re-downloaded.
  await page.getByTestId('stacked-download-job-0').click();
  await expect(stacked).toBeVisible();
  await expect(page.getByTestId('stacked-download-job-0')).toHaveText(/Downloaded/);

  // A second click asks for confirmation instead of silently re-downloading.
  await page.getByTestId('stacked-download-job-0').click();
  await expect(page.getByTestId('stacked-redownload-job-0')).toBeVisible();
  await page.getByTestId('stacked-redownload-cancel-job-0').click();
  await expect(page.getByTestId('stacked-redownload-job-0')).toHaveCount(0);

  // Confirming still keeps the card - it never auto-removes on save.
  await page.getByTestId('stacked-download-job-0').click();
  await page.getByTestId('stacked-redownload-yes-job-0').click();
  await expect(stacked).toBeVisible();
  await expect(page.getByTestId('result-card')).toBeVisible();
});
