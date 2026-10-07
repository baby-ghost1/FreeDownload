import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from './helpers.js';
import { users } from './auth.js';

/** Plans are data, not code - pricing and limits never live in application logic. */
export const plans = pgTable(
  'plans',
  {
    id: id(),
    code: text('code', { enum: ['free', 'pro', 'business'] }).notNull(),
    name: text('name').notNull(),
    tier: integer('tier').notNull().default(0),
    priceCents: integer('price_cents').notNull().default(0),
    currency: text('currency').notNull().default('usd'),
    interval: text('interval', { enum: ['month', 'year'] })
      .notNull()
      .default('month'),
    limits: jsonb('limits')
      .notNull()
      .$defaultFn(() => ({})),
    features: jsonb('features')
      .notNull()
      .$defaultFn(() => ({})),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('plans_code_unique').on(t.code)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    provider: text('provider').notNull().default('none'),
    providerRef: text('provider_ref'),
    status: text('status', {
      enum: ['trialing', 'active', 'past_due', 'canceled', 'incomplete'],
    })
      .notNull()
      .default('active'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('subscriptions_user_id_idx').on(t.userId),
    uniqueIndex('subscriptions_provider_ref_unique').on(t.providerRef),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id'),
    provider: text('provider').notNull().default('none'),
    providerRef: text('provider_ref'),
    amountCents: integer('amount_cents').notNull().default(0),
    currency: text('currency').notNull().default('usd'),
    status: text('status', {
      enum: ['pending', 'succeeded', 'failed', 'refunded', 'canceled'],
    }).notNull(),
    kind: text('kind', { enum: ['charge', 'refund', 'invoice'] })
      .notNull()
      .default('charge'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    raw: jsonb('raw'),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_user_id_created_at_idx').on(t.userId, t.createdAt),
    uniqueIndex('payments_provider_ref_unique').on(t.providerRef),
  ],
);

export const usageRecords = pgTable(
  'usage_records',
  {
    id: id(),
    // Calendar day (YYYY-MM-DD) so the unique constraint needs exact equality.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    jobsCreated: integer('jobs_created').notNull().default(0),
    jobsCompleted: integer('jobs_completed').notNull().default(0),
    bytesServed: integer('bytes_served').notNull().default(0),
    apiCalls: integer('api_calls').notNull().default(0),
  },
  (t) => [
    uniqueIndex('usage_records_user_id_day_unique').on(t.userId, t.day),
    index('usage_records_user_id_day_idx').on(t.userId, t.day),
  ],
);

export type Plan = typeof plans.$inferSelect;

/**
 * Manual-billing coupons (contract §Billing): admin-generated percent-off
 * codes applied to UPI upgrade requests. `usedCount` is bumped when an
 * upgrade request carrying the code is approved.
 */
export const coupons = pgTable(
  'coupons',
  {
    id: id(),
    code: text('code').notNull(),
    percentOff: integer('percent_off').notNull(),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    createdBy: text('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('coupons_code_unique').on(t.code)],
);

/**
 * Manual UPI upgrade requests: the user pays via QR, then asks an admin to
 * verify and activate the plan. One pending request per user at a time.
 */
export const upgradeRequests = pgTable(
  'upgrade_requests',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planCode: text('plan_code', { enum: ['pro', 'business'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('inr'),
    couponCode: text('coupon_code'),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'canceled'] })
      .notNull()
      .default('pending'),
    note: text('note'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('upgrade_requests_user_id_idx').on(t.userId),
    index('upgrade_requests_status_idx').on(t.status),
  ],
);
