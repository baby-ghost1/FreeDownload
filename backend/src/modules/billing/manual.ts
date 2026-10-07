import { and, desc, eq } from 'drizzle-orm';

import { AppError } from '../../errors/app-error.js';
import type { Database } from '../../database/client.js';
import { coupons, plans, subscriptions, upgradeRequests, users } from '../../database/schema/index.js';

/**
 * Manual UPI billing: the buyer pays over QR, optionally with a coupon,
 * then an admin verifies and activates the plan. No payment provider needed.
 */

export type ManualPlanCode = 'pro' | 'business';

export interface ResolvedCoupon {
  code: string;
  percentOff: number;
}

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** A coupon the buyer may apply - throws when unusable. */
export async function resolveCoupon(
  db: Database,
  rawCode: string | undefined,
): Promise<ResolvedCoupon | null> {
  if (!rawCode || rawCode.trim() === '') return null;
  const code = normalizeCouponCode(rawCode);
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
    throw new AppError('VALIDATION_ERROR', 'That coupon code is not valid.');
  }
  const rows = await db.select().from(coupons).where(eq(coupons.code, code)).limit(1);
  const coupon = rows[0];
  if (!coupon || !coupon.active) {
    throw new AppError('VALIDATION_ERROR', 'That coupon does not exist or is disabled.');
  }
  if (coupon.expiresAt && coupon.expiresAt.getTime() <= Date.now()) {
    throw new AppError('VALIDATION_ERROR', 'That coupon has expired.');
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    throw new AppError('VALIDATION_ERROR', 'That coupon has already been fully used.');
  }
  return { code: coupon.code, percentOff: coupon.percentOff };
}

export function discountedAmount(priceCents: number, coupon: ResolvedCoupon | null): number {
  if (!coupon) return priceCents;
  return Math.max(0, Math.round((priceCents * (100 - coupon.percentOff)) / 100));
}

/** Buyer-side price preview (coupon validated, nothing written). */
export async function getManualPreview(
  db: Database,
  planCode: ManualPlanCode,
  couponCode?: string,
) {
  const plan = await paidPlan(db, planCode);
  const coupon = await resolveCoupon(db, couponCode);
  return {
    amountCents: discountedAmount(plan.priceCents, coupon),
    currency: plan.currency,
    couponApplied: coupon !== null,
    percentOff: coupon?.percentOff ?? 0,
  };
}

async function paidPlan(db: Database, planCode: ManualPlanCode) {
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.code, planCode as 'pro' | 'business'))
    .limit(1);
  const plan = rows[0];
  if (!plan || !plan.active || plan.priceCents <= 0) {
    throw new AppError('VALIDATION_ERROR', 'That plan is not available right now.');
  }
  return plan;
}

/** Buyer side: file a pending request (one at a time). */
export async function createUpgradeRequest(
  db: Database,
  userId: string,
  planCode: ManualPlanCode,
  couponCode?: string,
) {
  const plan = await paidPlan(db, planCode);
  const coupon = await resolveCoupon(db, couponCode);

  const pending = await db
    .select({ id: upgradeRequests.id })
    .from(upgradeRequests)
    .where(and(eq(upgradeRequests.userId, userId), eq(upgradeRequests.status, 'pending')))
    .limit(1);
  if (pending.length > 0) {
    throw new AppError(
      'CONFLICT',
      'You already have a pending upgrade request. Cancel it first to file a new one.',
    );
  }

  const [row] = await db
    .insert(upgradeRequests)
    .values({
      userId,
      planCode,
      amountCents: discountedAmount(plan.priceCents, coupon),
      currency: plan.currency,
      couponCode: coupon?.code ?? null,
    })
    .returning();
  return row!;
}

/** Switch (or create) the user's subscription row to a plan, manually. */
export async function setUserPlan(
  db: Database,
  userId: string,
  planCode: ManualPlanCode | 'free',
  provider: string,
) {
  const target = planCode === 'free' ? 'free' : planCode;
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.code, target as 'free' | 'pro' | 'business'))
    .limit(1);
  const plan = rows[0];
  if (!plan) throw new AppError('VALIDATION_ERROR', 'That plan does not exist.');
  const now = new Date();

  const existing = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (existing[0]) {
    await db
      .update(subscriptions)
      .set({
        planId: plan.id,
        provider,
        providerRef: null,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, existing[0].id));
  } else {
    await db.insert(subscriptions).values({
      userId,
      planId: plan.id,
      provider,
      status: 'active',
      currentPeriodStart: now,
    });
  }
  return plan;
}

/** Admin side: approve a pending request (activates the plan). */
export async function approveUpgradeRequest(db: Database, requestId: string, adminId: string) {
  const rows = await db
    .select()
    .from(upgradeRequests)
    .where(eq(upgradeRequests.id, requestId))
    .limit(1);
  const request = rows[0];
  if (!request) throw new AppError('NOT_FOUND', 'Upgrade request not found.');
  if (request.status !== 'pending') {
    throw new AppError('CONFLICT', `That request is already ${request.status}.`);
  }

  // Re-resolve the coupon at approval time so exhausted codes cannot slip in.
  const coupon = request.couponCode
    ? await resolveCoupon(db, request.couponCode).catch(() => null)
    : null;
  if (request.couponCode && !coupon) {
    throw new AppError('CONFLICT', 'The attached coupon is no longer usable.');
  }

  await setUserPlan(db, request.userId, request.planCode, 'manual');

  if (coupon) {
    const crow = (
      await db.select().from(coupons).where(eq(coupons.code, coupon.code)).limit(1)
    )[0];
    if (crow) {
      await db
        .update(coupons)
        .set({ usedCount: crow.usedCount + 1 })
        .where(eq(coupons.id, crow.id));
    }
  }

  const now = new Date();
  await db
    .update(upgradeRequests)
    .set({ status: 'approved', reviewedBy: adminId, reviewedAt: now, updatedAt: now })
    .where(eq(upgradeRequests.id, request.id));

  // Anything else this user had pending is now moot.
  await db
    .update(upgradeRequests)
    .set({ status: 'canceled', reviewedBy: adminId, reviewedAt: now, updatedAt: now })
    .where(and(eq(upgradeRequests.userId, request.userId), eq(upgradeRequests.status, 'pending')));

  return request;
}

/** Delete a user outright (cascades sessions, keys, subscriptions; jobs go anonymous). */
export async function deleteUser(db: Database, userId: string): Promise<void> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'User not found.');
  await db.delete(users).where(eq(users.id, userId));
}
