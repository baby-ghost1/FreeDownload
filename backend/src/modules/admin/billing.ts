import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';

import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { AppError } from '../../errors/app-error.js';
import { errorResponses } from '../../http/error-schema.js';
import { assertCsrf } from '../../security/csrf.js';
import { verifyPassword } from '../../security/passwords.js';
import { coupons, upgradeRequests, users } from '../../database/schema/index.js';
import { writeAudit } from './audit.js';
import { assertMutatorRole, requireAdmin } from './session.js';
import {
  approveUpgradeRequest,
  deleteUser,
  normalizeCouponCode,
  setUserPlan,
  type ManualPlanCode,
} from '../billing/manual.js';

const IdParams = z.object({ id: z.uuid('A valid id is required.') });
const OkSchema = z.object({ ok: z.literal(true) });

const UpgradeRequestSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string().nullable(),
  planCode: z.enum(['pro', 'business']),
  amountCents: z.number(),
  currency: z.string(),
  couponCode: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected', 'canceled']),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

const CouponSchema = z.object({
  id: z.string(),
  code: z.string(),
  percentOff: z.number(),
  maxUses: z.number().nullable(),
  usedCount: z.number(),
  expiresAt: z.coerce.date().nullable(),
  active: z.boolean(),
  createdAt: z.coerce.date(),
});

const CouponBody = z.object({
  code: z.string().trim().min(4).max(32),
  percentOff: z.number().int().min(1).max(100),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

const CouponPatchBody = z
  .object({
    percentOff: z.number().int().min(1).max(100).optional(),
    maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });

const SetPlanBody = z.object({ planCode: z.enum(['free', 'pro', 'business']) });
const RejectBody = z.object({ reason: z.string().max(500).nullable().optional() });

/**
 * Manual-billing console (§Billing): upgrade requests, coupons, direct plan
 * changes and user deletion (own-password confirmed). Owner/admin only.
 */
export async function registerAdminBillingRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/admin/upgrade-requests',
    {
      schema: {
        description: 'Manual upgrade requests, filterable by status.',
        querystring: z.object({
          status: z.enum(['pending', 'approved', 'rejected', 'canceled']).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({ data: z.array(UpgradeRequestSchema) }),
          ...errorResponses(400, 401, 403),
        },
      },
    },
    async (req) => {
      requireAdmin(req);
      const db = getDb();
      const base = db
        .select({
          id: upgradeRequests.id,
          userId: upgradeRequests.userId,
          userEmail: users.email,
          planCode: upgradeRequests.planCode,
          amountCents: upgradeRequests.amountCents,
          currency: upgradeRequests.currency,
          couponCode: upgradeRequests.couponCode,
          status: upgradeRequests.status,
          reviewedBy: upgradeRequests.reviewedBy,
          reviewedAt: upgradeRequests.reviewedAt,
          createdAt: upgradeRequests.createdAt,
        })
        .from(upgradeRequests)
        .innerJoin(users, eq(upgradeRequests.userId, users.id))
        .$dynamic();
      const rows = await (req.query.status
        ? base.where(eq(upgradeRequests.status, req.query.status))
        : base
      )
        .orderBy(desc(upgradeRequests.createdAt))
        .limit(req.query.limit);
      return { data: rows };
    },
  );

  app.post(
    '/admin/upgrade-requests/:id/approve',
    {
      schema: {
        description: 'Verify payment and activate the plan (owner/admin only).',
        params: IdParams,
        response: { 200: OkSchema, ...errorResponses(401, 403, 404, 409) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const row = await approveUpgradeRequest(db, req.params.id, context.admin.id);
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'billing.upgrade.approve',
        resource: 'upgrade_requests',
        resourceId: row.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { plan: row.planCode, amountCents: row.amountCents },
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/admin/upgrade-requests/:id/reject',
    {
      schema: {
        description: 'Reject a manual upgrade request (owner/admin only).',
        params: IdParams,
        body: RejectBody,
        response: { 200: OkSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const rows = await db
        .select()
        .from(upgradeRequests)
        .where(eq(upgradeRequests.id, req.params.id))
        .limit(1);
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'Upgrade request not found.');
      if (row.status !== 'pending') {
        throw new AppError('CONFLICT', `That request is already ${row.status}.`);
      }
      const now = new Date();
      await db
        .update(upgradeRequests)
        .set({
          status: 'rejected',
          note: req.body.reason ?? null,
          reviewedBy: context.admin.id,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(upgradeRequests.id, row.id));
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'billing.upgrade.reject',
        resource: 'upgrade_requests',
        resourceId: row.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      return { ok: true as const };
    },
  );

  app.get(
    '/admin/coupons',
    {
      schema: {
        description: 'All coupons, newest first.',
        response: { 200: z.object({ data: z.array(CouponSchema) }), ...errorResponses(401, 403) },
      },
    },
    async (req) => {
      requireAdmin(req);
      const rows = await getDb()
        .select()
        .from(coupons)
        .orderBy(desc(coupons.createdAt))
        .limit(100);
      return { data: rows };
    },
  );

  app.post(
    '/admin/coupons',
    {
      schema: {
        description: 'Generate a coupon (owner/admin only).',
        body: CouponBody,
        response: { 201: CouponSchema, ...errorResponses(400, 401, 403, 409) },
      },
    },
    async (req, reply) => {
      assertCsrf(req);
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const code = normalizeCouponCode(req.body.code);
      if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
        throw new AppError('VALIDATION_ERROR', 'Coupon codes are 4-32 chars of A-Z, 0-9, dash.');
      }
      try {
        const [row] = await db
          .insert(coupons)
          .values({
            code,
            percentOff: req.body.percentOff,
            maxUses: req.body.maxUses ?? null,
            expiresAt: req.body.expiresAt ?? null,
            createdBy: context.admin.id,
          })
          .returning();
        await writeAudit(db, {
          adminId: context.admin.id,
          action: 'billing.coupon.create',
          resource: 'coupons',
          resourceId: row!.code,
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          metadata: { percentOff: row!.percentOff },
        });
        return reply.status(201).send(row!);
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          throw new AppError('CONFLICT', 'That coupon code already exists.');
        }
        throw err;
      }
    },
  );

  app.patch(
    '/admin/coupons/:code',
    {
      schema: {
        description: 'Tune a coupon (owner/admin only).',
        params: z.object({ code: z.string().min(1).max(32) }),
        body: CouponPatchBody,
        response: { 200: CouponSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const rows = await db
        .update(coupons)
        .set({ ...req.body })
        .where(eq(coupons.code, normalizeCouponCode(req.params.code)))
        .returning();
      const row = rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'Coupon not found.');
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'billing.coupon.update',
        resource: 'coupons',
        resourceId: row.code,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      return row;
    },
  );

  app.patch(
    '/admin/users/:id/plan',
    {
      schema: {
        description: "Set a user's plan directly, no payment (owner/admin only).",
        params: IdParams,
        body: SetPlanBody,
        response: { 200: OkSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const target = (
        await db.select({ id: users.id }).from(users).where(eq(users.id, req.params.id)).limit(1)
      )[0];
      if (!target) throw new AppError('NOT_FOUND', 'User not found.');
      await setUserPlan(db, target.id, req.body.planCode as ManualPlanCode | 'free', 'manual');
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'billing.plan.set',
        resource: 'users',
        resourceId: target.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { plan: req.body.planCode },
      });
      return { ok: true as const };
    },
  );

  app.delete(
    '/admin/users/:id',
    {
      schema: {
        description:
          'Delete a user outright (owner/admin only, own password required to confirm).',
        params: IdParams,
        body: z.object({ password: z.string().min(1).max(256) }),
        response: { 200: OkSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (req, reply) => {
      assertCsrf(req);
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const ok = await verifyPassword(context.admin.passwordHash, req.body.password);
      if (!ok) {
        throw new AppError('UNAUTHORIZED', 'Your admin password is incorrect.');
      }
      const db = getDb();
      await deleteUser(db, req.params.id);
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'user.delete',
        resource: 'users',
        resourceId: req.params.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      return reply.send({ ok: true as const });
    },
  );
}
