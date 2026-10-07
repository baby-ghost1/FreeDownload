import type { Page, Route } from '@playwright/test';

import {
  analyzeResult,
  apiKey,
  apiKeyUsage,
  createdApiKey,
  freeSubscription,
  jobFixture,
  jobResult,
  notFound,
  planList,
  publicConfig,
  session,
  sessionsFixture,
  targetFormats,
  unauthorized,
  usageFixture,
  user,
} from './fixtures';
import type { ApiKeyInfo, Subscription } from '@/lib/api/types';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export interface ApiMockOptions {
  /** Respond to `/me` with the fixture user instead of 401. */
  signedIn?: boolean;
  /** Subscription returned by `/subscriptions/*` (defaults to free). */
  subscription?: Subscription;
  /** Overrides for the public config feature flags. */
  flags?: Record<string, boolean>;
}

/**
 * Intercepts every backend call for one page. The job endpoint walks
 * queued → processing → completed across polls so the UI's progress flow is
 * exercised exactly like production. Billing endpoints keep in-memory state so
 * downgrade/cancel flows can be asserted.
 */
export class ApiMock {
  private jobPolls = 0;
  private subscription: Subscription;
  private keys: ApiKeyInfo[] = [apiKey];
  private upgradeRequests: Array<Record<string, unknown>> = [];
  /** Mirrors the real cookie session: auth POSTs flip this on (and off on logout). */
  private signedIn: boolean;

  constructor(
    private readonly page: Page,
    private readonly opts: ApiMockOptions = {},
  ) {
    this.subscription = opts.subscription ?? freeSubscription;
    this.signedIn = opts.signedIn ?? false;
  }

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
      return this.json(route, this.signedIn ? user : unauthorized, this.signedIn ? 200 : 401);
    }
    if (path === '/auth/login' && method === 'POST') {
      this.signedIn = true;
      return this.json(route, session);
    }
    if (path === '/auth/register' && method === 'POST') {
      // Echo the submitted profile so assertions on the header are honest.
      this.signedIn = true;
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
    if (path === '/auth/logout' && method === 'POST') {
      this.signedIn = false;
      return this.json(route, { ok: true });
    }
    if (path === '/config/public') {
      return this.json(route, {
        ...publicConfig,
        flags: this.opts.flags ?? publicConfig.flags,
      });
    }
    if (path === '/formats') return this.json(route, { data: targetFormats });
    if (path === '/me/usage') return this.json(route, usageFixture);
    if (path === '/me/sessions') return this.json(route, { data: sessionsFixture });

    // --- billing + API keys (Phase 7) ---------------------------------------
    if (path === '/plans') return this.json(route, { data: planList });
    if (path === '/subscriptions/current') return this.json(route, this.subscription);
    if (path === '/subscriptions' && method === 'POST') {
      this.subscription = freeSubscription;
      return this.json(route, this.subscription);
    }
    if (path === '/subscriptions/cancel' && method === 'POST') {
      // Mirrors the API: a canceled subscription resolves to the free plan.
      this.subscription = {
        ...freeSubscription,
        status: 'canceled',
        canceledAt: user.createdAt,
        provider: this.subscription.provider,
      };
      return this.json(route, this.subscription);
    }
    if (path === '/payments/checkout' && method === 'POST') {
      return this.json(
        route,
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Billing is not configured.',
            requestId: 'e2e',
          },
        },
        503,
      );
    }
    if (path === '/subscriptions/upgrade-requests/preview' && method === 'POST') {
      return this.json(route, {
        amountCents: 999,
        currency: 'inr',
        couponApplied: false,
        percentOff: 0,
      });
    }
    if (path === '/subscriptions/upgrade-requests' && method === 'POST') {
      this.upgradeRequests = [
        {
          id: 'ur-1',
          planCode: 'pro',
          amountCents: 999,
          currency: 'inr',
          couponCode: null,
          status: 'pending',
          reviewedAt: null,
          createdAt: '2026-10-03T12:00:00.000Z',
        },
      ];
      return this.json(route, this.upgradeRequests[0], 201);
    }
    if (path === '/subscriptions/upgrade-requests' && method === 'GET') {
      return this.json(route, { data: this.upgradeRequests ?? [] });
    }
    if (path === '/api-keys' && method === 'GET') {
      return this.json(route, { data: this.keys });
    }
    if (path === '/api-keys' && method === 'POST') {
      const fresh = { ...createdApiKey, id: 'key-2' };
      this.keys = [...this.keys, fresh];
      return this.json(route, fresh, 201);
    }
    if (path.startsWith('/api-keys/') && path.endsWith('/usage')) {
      return this.json(route, apiKeyUsage);
    }
    if (path.startsWith('/api-keys/') && method === 'DELETE') {
      const id = path.slice('/api-keys/'.length);
      this.keys = this.keys.map((k) => (k.id === id ? { ...k, revokedAt: user.createdAt } : k));
      return this.json(route, { id, revokedAt: user.createdAt });
    }
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
