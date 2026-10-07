import { z } from 'zod';

import { asc, desc, eq } from 'drizzle-orm';

import { config } from '../../server/config.js';
import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { AppError } from '../../errors/app-error.js';
import { assertCsrf } from '../../security/csrf.js';
import { errorResponses } from '../../http/error-schema.js';
import { plans, subscriptions, type Plan } from '../../database/schema/index.js';
import { requireAuth } from '../auth/session.js';
import { getPaymentProvider } from '../../payments/provider.js';
import { parseStripeEvent, verifyStripeSignature } from '../../payments/webhook.js';
import { applyStripeEvent } from './events.js';
import { createUpgradeRequest, getManualPreview } from './manual.js';
import { upgradeRequests } from '../../database/schema/index.js';

const PlanSchema = z.object({
  code: z.enum(['free', 'pro', 'business']),
  name: z.string(),
  tier: z.number(),
  priceCents: z.number(),
  currency: z.string(),
  interval: z.enum(['month', 'year']),
  limits: z.unknown(),
  features: z.unknown(),
  sortOrder: z.number(),
});

const PlanListSchema = z.object({ data: z.array(PlanSchema) });

const SubscriptionSchema = z.object({
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'incomplete']),
  provider: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodStart: z.coerce.date().nullable(),
  currentPeriodEnd: z.coerce.date().nullable(),
  canceledAt: z.coerce.date().nullable(),
  plan: PlanSchema,
});

const PlanBody = z.object({ planCode: z.enum(['free', 'pro', 'business']) });

const CheckoutSchema = z.object({ url: z.string().url(), providerRef: z.string() });

const WebhookSchema = z.object({ received: z.boolean() });

const WebhookBody = z.string();

function toPlanResponse(plan: Plan) {
  return {
    code: plan.code,
    name: plan.name,
    tier: plan.tier,
    priceCents: plan.priceCents,
    currency: plan.currency,
    interval: plan.interval,
    limits: plan.limits,
    features: plan.features,
    sortOrder: plan.sortOrder,
  };
}

async function freePlan() {
  const row = await getDb().select().from(plans).where(eq(plans.code, 'free')).limit(1);
  if (!row[0]) throw new AppError('SERVICE_UNAVAILABLE', 'Plans are not configured.');
  return row[0];
}

/** Effective subscription + plan for the caller (free fallback). */
async function currentFor(userId: string) {
  const db = getDb();
  const rows = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  const row = rows[0];
  const live = row && row.sub.status !== 'canceled';
  if (row && live) {
    return {
      status: row.sub.status,
      provider: row.sub.provider,
      cancelAtPeriodEnd: row.sub.cancelAtPeriodEnd,
      currentPeriodStart: row.sub.currentPeriodStart,
      currentPeriodEnd: row.sub.currentPeriodEnd,
      canceledAt: row.sub.canceledAt,
      plan: toPlanResponse(row.plan),
    };
  }

  const free = await freePlan();
  return {
    status: (row ? 'canceled' : 'active') as 'canceled' | 'active',
    provider: 'none',
    cancelAtPeriodEnd: false,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    canceledAt: row?.sub.canceledAt ?? null,
    plan: toPlanResponse(free),
  };
}

/**
 * Plans, subscriptions and payments (Phase 7, contract §Billing). Checkout
 * depends on `PAYMENT_PROVIDER`; webhooks verify signatures against
 * `PAYMENT_WEBHOOK_SECRET` over the raw request bytes.
 */
export async function registerBillingRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/plans',
    {
      schema: {
        description: 'Public pricing: active plans ordered for display.',
        response: { 200: PlanListSchema },
      },
    },
    async () => {
      const rows = await getDb()
        .select()
        .from(plans)
        .where(eq(plans.active, true))
        .orderBy(asc(plans.sortOrder));
      return { data: rows.map(toPlanResponse) };
    },
  );

  app.get(
    '/subscriptions/current',
    {
      schema: {
        description: 'Current subscription, falling back to the free plan.',
        response: { 200: SubscriptionSchema, ...errorResponses(401, 503) },
      },
    },
    async (req) => {
      const auth = requireAuth(req);
      return currentFor(auth.user.id);
    },
  );

  app.post(
    '/subscriptions',
    {
      schema: {
        description:
          'Switch to another plan. Paid plans start a checkout instead - ' +
          'this endpoint only downgrades to free immediately.',
        body: PlanBody,
        response: { 200: SubscriptionSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const auth = requireAuth(req);
      const { planCode } = req.body;

      if (planCode !== 'free') {
        throw new AppError(
          'VALIDATION_ERROR',
          'Paid plans are started through POST /payments/checkout.',
        );
      }

      const db = getDb();
      const free = await freePlan();
      const existing = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.userId, auth.user.id))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);

      if (existing[0]) {
        await db
          .update(subscriptions)
          .set({
            planId: free.id,
            provider: 'none',
            providerRef: null,
            status: 'active',
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            canceledAt: null,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, existing[0].id));
      }

      return currentFor(auth.user.id);
    },
  );

  app.post(
    '/subscriptions/cancel',
    {
      schema: {
        description:
          'Cancel the subscription: free plans cancel immediately, provider ' +
          'subscriptions at the period end (cancel_at_period_end).',
        response: { 200: SubscriptionSchema, ...errorResponses(401, 403, 409, 503) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const auth = requireAuth(req);

      const db = getDb();
      const rows = await db
        .select({ sub: subscriptions })
        .from(subscriptions)
        .where(eq(subscriptions.userId, auth.user.id))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);

      const row = rows[0]?.sub;
      if (!row || row.status === 'canceled') {
        throw new AppError('CONFLICT', 'There is no active subscription to cancel.');
      }

      const now = new Date();
      if (row.provider === 'none') {
        await db
          .update(subscriptions)
          .set({ status: 'canceled', canceledAt: now, updatedAt: now })
          .where(eq(subscriptions.id, row.id));
      } else {
        await db
          .update(subscriptions)
          .set({ cancelAtPeriodEnd: true, updatedAt: now })
          .where(eq(subscriptions.id, row.id));
      }

      return currentFor(auth.user.id);
    },
  );

  const UpgradeRequestSchema = z.object({
    id: z.string(),
    planCode: z.enum(['pro', 'business']),
    amountCents: z.number(),
    currency: z.string(),
    couponCode: z.string().nullable(),
    status: z.enum(['pending', 'approved', 'rejected', 'canceled']),
    reviewedAt: z.coerce.date().nullable(),
    createdAt: z.coerce.date(),
  });

  const UpgradeRequestBody = z.object({
    planCode: z.enum(['pro', 'business']),
    couponCode: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .optional(),
  });

  app.get(
    '/subscriptions/upgrade-requests',
    {
      schema: {
        description: 'My manual upgrade requests, newest first.',
        response: {
          200: z.object({ data: z.array(UpgradeRequestSchema) }),
          ...errorResponses(401),
        },
      },
    },
    async (req) => {
      const auth = requireAuth(req);
      const rows = await getDb()
        .select()
        .from(upgradeRequests)
        .where(eq(upgradeRequests.userId, auth.user.id))
        .orderBy(desc(upgradeRequests.createdAt))
        .limit(20);
      return { data: rows };
    },
  );

  app.post(
    '/subscriptions/upgrade-requests/preview',
    {
      schema: {
        description: 'Price preview for a manual upgrade with an optional coupon.',
        body: UpgradeRequestBody,
        response: {
          200: z.object({
            amountCents: z.number(),
            currency: z.string(),
            couponApplied: z.boolean(),
            percentOff: z.number(),
          }),
          ...errorResponses(400, 401),
        },
      },
    },
    async (req) => {
      requireAuth(req);
      return getManualPreview(getDb(), req.body.planCode, req.body.couponCode);
    },
  );

  app.post(
    '/subscriptions/upgrade-requests',
    {
      schema: {
        description:
          'File a manual upgrade request after paying over UPI (admin verifies).',
        body: UpgradeRequestBody,
        response: { 201: UpgradeRequestSchema, ...errorResponses(400, 401, 409) },
      },
    },
    async (req, reply) => {
      assertCsrf(req);
      const auth = requireAuth(req);
      const row = await createUpgradeRequest(
        getDb(),
        auth.user.id,
        req.body.planCode,
        req.body.couponCode,
      );
      return reply.status(201).send(row);
    },
  );

  app.delete(
    '/subscriptions/upgrade-requests/:id',
    {
      schema: {
        description: 'Cancel my pending upgrade request.',
        params: z.object({ id: z.uuid('A valid id is required.') }),
        response: {
          200: z.object({ ok: z.literal(true) }),
          ...errorResponses(400, 401, 404, 409),
        },
      },
    },
    async (req) => {
      assertCsrf(req);
      const auth = requireAuth(req);
      const db = getDb();
      const rows = await db
        .select()
        .from(upgradeRequests)
        .where(eq(upgradeRequests.id, req.params.id))
        .limit(1);
      const row = rows[0];
      if (!row || row.userId !== auth.user.id) {
        throw new AppError('NOT_FOUND', 'Upgrade request not found.');
      }
      if (row.status !== 'pending') {
        throw new AppError('CONFLICT', `That request is already ${row.status}.`);
      }
      await db
        .update(upgradeRequests)
        .set({ status: 'canceled', updatedAt: new Date() })
        .where(eq(upgradeRequests.id, row.id));
      return { ok: true as const };
    },
  );

  app.post(
    '/payments/checkout',
    {
      schema: {
        description: 'Start a checkout session for a paid plan.',
        body: PlanBody,
        response: { 200: CheckoutSchema, ...errorResponses(400, 401, 403, 503) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const auth = requireAuth(req);
      const { planCode } = req.body;

      const rows = await getDb().select().from(plans).where(eq(plans.code, planCode)).limit(1);
      const plan = rows[0];
      if (!plan || !plan.active || plan.priceCents <= 0) {
        throw new AppError('VALIDATION_ERROR', 'That plan is not available for checkout.');
      }

      const session = await getPaymentProvider().createCheckout({
        userId: auth.user.id,
        planCode: plan.code,
        planName: plan.name,
        priceCents: plan.priceCents,
        currency: plan.currency,
        interval: plan.interval,
      });
      return { url: session.url, providerRef: session.providerRef };
    },
  );

  // Webhooks need the exact bytes Stripe signed - a child scope replaces the
  // JSON parser with a raw-string passthrough for this route only.
  await app.register(async (webhookScope) => {
    webhookScope.removeAllContentTypeParsers();
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_req, body: string, done) => {
        done(null, body);
      },
    );

    webhookScope.post(
      '/payments/webhook',
      {
        schema: {
          description: 'Stripe webhook: signature-verified, idempotent by design.',
          body: WebhookBody,
          response: { 200: WebhookSchema, ...errorResponses(400, 401, 503) },
        },
      },
      async (req) => {
        const secret = config.payment.webhookSecret;
        if (!secret) {
          throw new AppError('SERVICE_UNAVAILABLE', 'Webhooks are not configured.');
        }

        const rawBody = typeof req.body === 'string' ? req.body : '';
        const signature = req.headers['stripe-signature'];
        const header = Array.isArray(signature) ? signature[0] : signature;
        if (!verifyStripeSignature(rawBody, header, secret)) {
          throw new AppError('UNAUTHORIZED', 'Webhook signature verification failed.');
        }

        const event = parseStripeEvent(rawBody);
        await applyStripeEvent(getDb(), event);
        return { received: true };
      },
    );
  });
}
