import { eq } from 'drizzle-orm';

import type { Database } from '../../database/client.js';
import { logger } from '../../logging/logger.js';
import { payments, plans, subscriptions, users } from '../../database/schema/index.js';
import type { StripeEvent } from '../../payments/webhook.js';

/**
 * Webhook event application (Phase 7).
 *
 * Idempotency is natural-key based - subscriptions upsert on `provider_ref`
 * and payments do `ON CONFLICT DO NOTHING` on it - so redelivered events are
 * no-ops without tracking event ids.
 */
export interface ApplyResult {
  handled: boolean;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function metadataOf(obj: Record<string, unknown>): { userId?: string; planCode?: string } {
  const meta = obj.metadata as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object') return {};
  const userId = str(meta.userId);
  const planCode = str(meta.planCode);
  return {
    ...(userId ? { userId } : {}),
    ...(planCode ? { planCode } : {}),
  };
}

async function applyCheckoutCompleted(db: Database, event: StripeEvent): Promise<ApplyResult> {
  const obj = event.data?.object;
  if (!obj || typeof obj !== 'object') return { handled: false };

  const checkoutRef = str(obj.id);
  const { userId, planCode } = metadataOf(obj as Record<string, unknown>);
  if (!checkoutRef || !userId || !planCode) {
    logger.warn({ eventId: event.id }, 'checkout event missing identifiers - ignored');
    return { handled: false };
  }
  if (planCode !== 'free' && planCode !== 'pro' && planCode !== 'business') {
    logger.warn({ eventId: event.id, planCode }, 'checkout event for unknown plan - ignored');
    return { handled: false };
  }

  const user = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  const plan = await db.select().from(plans).where(eq(plans.code, planCode)).limit(1);
  if (!user[0] || !plan[0]) {
    logger.warn(
      { eventId: event.id, userId, planCode },
      'checkout event for unknown user/plan - ignored',
    );
    return { handled: false };
  }

  const providerRef = str(obj.subscription) ?? checkoutRef;
  const amountTotal = typeof obj.amount_total === 'number' ? obj.amount_total : plan[0].priceCents;
  const currency = str(obj.currency) ?? plan[0].currency;
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 86_400_000);

  const inserted = await db
    .insert(subscriptions)
    .values({
      userId,
      planId: plan[0].id,
      provider: 'stripe',
      providerRef,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    })
    .onConflictDoUpdate({
      target: subscriptions.providerRef,
      set: {
        userId,
        planId: plan[0].id,
        provider: 'stripe',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        updatedAt: now,
      },
    })
    .returning();

  await db
    .insert(payments)
    .values({
      userId,
      subscriptionId: inserted[0]?.id ?? null,
      provider: 'stripe',
      providerRef: checkoutRef,
      amountCents: amountTotal,
      currency,
      status: 'succeeded',
      kind: 'charge',
      paidAt: now,
      raw: event,
    })
    .onConflictDoNothing({ target: payments.providerRef });

  return { handled: true };
}

async function applySubscriptionDeleted(db: Database, event: StripeEvent): Promise<ApplyResult> {
  const obj = event.data?.object;
  if (!obj || typeof obj !== 'object') return { handled: false };

  const providerRef = str(obj.id);
  if (!providerRef) return { handled: false };

  await db
    .update(subscriptions)
    .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
    .where(eq(subscriptions.providerRef, providerRef));

  return { handled: true };
}

export async function applyStripeEvent(db: Database, event: StripeEvent): Promise<ApplyResult> {
  switch (event.type) {
    case 'checkout.session.completed':
      return applyCheckoutCompleted(db, event);
    case 'customer.subscription.deleted':
      return applySubscriptionDeleted(db, event);
    default:
      // Unknown event types are acknowledged without side effects.
      return { handled: false };
  }
}
