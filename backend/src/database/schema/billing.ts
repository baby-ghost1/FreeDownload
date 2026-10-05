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
