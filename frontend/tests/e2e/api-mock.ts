import type { Page, Route } from '@playwright/test';

import {
  analyzeResult,
  jobFixture,
  jobResult,
  notFound,
  publicConfig,
  session,
  targetFormats,
  unauthorized,
  user,
} from './fixtures';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export interface ApiMockOptions {
  /** Respond to `/me` with the fixture user instead of 401. */
  signedIn?: boolean;
}

/**
 * Intercepts every backend call for one page. The job endpoint walks
 * queued → processing → completed across polls so the UI's progress flow
 * is exercised exactly like production.
 */
export class ApiMock {
  private jobPolls = 0;

  constructor(
    private readonly page: Page,
    private readonly opts: ApiMockOptions = {},
  ) {}

  async install(): Promise<void> {
    await this.page.route('http://localhost:4000/**', (route) => this.handle(route));
    await this.page.route('https://media.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }),
    );
  }

  private json(route: Route, body: unknown, status = 200): Promise<void> {
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '');

    if (path === '/me') {
      return this.json(
        route,
        this.opts.signedIn ? user : unauthorized,
        this.opts.signedIn ? 200 : 401,
      );
    }
    if (path === '/auth/login' && method === 'POST') return this.json(route, session);
    if (path === '/auth/register' && method === 'POST') {
      // Echo the submitted profile so assertions on the header are honest.
      const body = request.postDataJSON() as { email?: string; displayName?: string | null };
      return this.json(route, {
        user: {
          ...user,
          email: body.email ?? user.email,
          displayName: body.displayName ?? null,
        },
        csrfToken: 'csrf-e2e',
      });
    }
    if (path === '/auth/logout' && method === 'POST') return this.json(route, { ok: true });
    if (path === '/config/public') return this.json(route, publicConfig);
    if (path === '/formats') return this.json(route, { data: targetFormats });
    if (path === '/downloads/analyze' && method === 'POST') return this.json(route, analyzeResult);
    if (path === '/downloads' && method === 'POST') return this.json(route, jobFixture());
    if (path === '/downloads' && method === 'GET') {
      return this.json(route, { data: [jobFixture({ status: 'completed', progress: 100 })] });
    }
    if (path === '/downloads/job-1/result') return this.json(route, jobResult);
    if (path === '/downloads/job-1/cancel' && method === 'POST') {
      return this.json(route, jobFixture({ status: 'cancelled' }));
    }
    if (path === '/downloads/job-1' && method === 'GET') {
      this.jobPolls += 1;
      if (this.jobPolls <= 1) return this.json(route, jobFixture({ status: 'queued' }));
      if (this.jobPolls === 2)
        return this.json(route, jobFixture({ status: 'processing', progress: 62 }));
      return this.json(
        route,
        jobFixture({
          status: 'completed',
          progress: 100,
          requestedFormat: '1080p',
          targetContainer: 'mp4',
          completedAt: '2026-10-03T12:05:00.000Z',
        }),
      );
    }
    return this.json(route, notFound(method, path), 404);
  }
}
