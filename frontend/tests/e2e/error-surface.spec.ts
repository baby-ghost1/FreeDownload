import { expect, test, type Route } from '@playwright/test';

/**
 * docs/security.md: "E2E asserts that no stack trace reaches the DOM."
 *
 * Two 500 shapes are replayed: Fastify's default dev serialization
 * (top-level `stack`) and the envelope with a leaked `stack` sibling.
 * The UI must render only the safe message — never frame markers.
 */
const STACK_PROBE = 'STACK_PROBE_MUST_NOT_RENDER';
const STACK = `Error: boom\n    at handler (/app/node_modules/fastify/lib/handler.js:1:1)\n    at ${STACK_PROBE}`;

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function expectNoStackInDom(page: import('@playwright/test').Page): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text).not.toContain(STACK_PROBE);
  expect(text).not.toContain('node_modules');
  expect(text).not.toMatch(/\bat\s+\S+\.js:\d+:\d+/);
}

test('fastify-style 500 with top-level stack renders the generic message only', async ({
  page,
}) => {
  await page.route('http://localhost:4000/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/downloads/analyze')) {
      return json(
        route,
        {
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Internal Server Error',
          stack: STACK,
        },
        500,
      );
    }
    return json(
      route,
      { error: { code: 'NOT_FOUND', message: 'not mocked', requestId: 'e2e' } },
      404,
    );
  });

  await page.goto('/download');
  await page.getByLabel('Media link').fill('https://example.com/video');
  await page.getByTestId('analyze').click();

  await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toContainText(
    'The server had a problem. Try again.',
  );
  await expectNoStackInDom(page);
});

test('error envelope with a leaked stack sibling renders message without the stack', async ({
  page,
}) => {
  await page.route('http://localhost:4000/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/downloads/analyze')) {
      return json(
        route,
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Something went wrong. Try again shortly.',
            requestId: 'req-e2e',
          },
          stack: STACK,
        },
        500,
      );
    }
    return json(
      route,
      { error: { code: 'NOT_FOUND', message: 'not mocked', requestId: 'e2e' } },
      404,
    );
  });

  await page.goto('/download');
  await page.getByLabel('Media link').fill('https://example.com/video');
  await page.getByTestId('analyze').click();

  await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toContainText(
    'Something went wrong. Try again shortly.',
  );
  await expectNoStackInDom(page);
});
