import { z } from 'zod';

import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { errorResponses } from '../../http/error-schema.js';
import { writeAudit } from './audit.js';
import { assertMutatorRole, requireAdmin } from './session.js';
import {
  cancelJob,
  getJob,
  getOverview,
  getSource,
  listAuditLogs,
  listFlags,
  listJobs,
  listSettings,
  listSources,
  listUsers,
  retryJob,
  updateFlag,
  updateSetting,
  updateSource,
  updateUser,
} from './service.js';

const JobStatusSchema = z.enum([
  'created',
  'validating',
  'queued',
  'analyzing',
  'ready',
  'processing',
  'uploading',
  'completed',
  'failed',
  'retrying',
  'policy_restricted',
  'cancelled',
  'expired',
  'dead_letter',
]);

const IdParams = z.object({ id: z.uuid('A valid id is required.') });

const KeyParams = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_.-]*$/, 'Invalid key.'),
});

const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

const JobsQuery = PageQuery.extend({ status: JobStatusSchema.optional() });

const AuditsQuery = PageQuery.extend({
  resource: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(64).optional(),
});

const JobSchema = z.object({
  id: z.string(),
  status: JobStatusSchema,
  progress: z.number(),
  url: z.string(),
  requestedFormat: z.string().nullable(),
  targetContainer: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  retryCount: z.number(),
  userId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
});

const SourceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  adapterKey: z.string(),
  enabled: z.boolean(),
  mode: z.enum(['active', 'maintenance', 'restricted', 'disabled']),
  allowedFormats: z.unknown(),
  maxFileSizeMb: z.number().nullable(),
  requiresAuth: z.boolean(),
  priority: z.number(),
  healthStatus: z.enum(['unknown', 'healthy', 'degraded', 'down']),
  notes: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const SourcePatchBody = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(['active', 'maintenance', 'restricted', 'disabled']).optional(),
    allowedFormats: z.array(z.string().min(1).max(32)).max(16).optional(),
    maxFileSizeMb: z.number().int().min(1).max(100_000).nullable().optional(),
    requiresAuth: z.boolean().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update.' });

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  status: z.enum(['pending', 'active', 'suspended', 'deleted']),
  emailVerifiedAt: z.coerce.date().nullable(),
  lastLoginAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

const UserPatchBody = z.object({ status: z.enum(['active', 'suspended']) });

const AuditSchema = z.object({
  id: z.string(),
  adminId: z.string().nullable(),
  action: z.string(),
  resource: z.string().nullable(),
  resourceId: z.string().nullable(),
  ip: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.coerce.date(),
});

const FlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  rollout: z.number(),
  updatedAt: z.coerce.date().nullable(),
});

const FlagPatchBody = z
  .object({
    enabled: z.boolean().optional(),
    rollout: z.number().int().min(0).max(100).optional(),
  })
  .refine((body) => body.enabled !== undefined || body.rollout !== undefined, {
    message: 'Nothing to update.',
  });

const SettingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  updatedAt: z.coerce.date().nullable(),
});

const SettingPatchBody = z.object({
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.unknown()),
    z.record(z.string(), z.unknown()),
  ]),
});

const OverviewSchema = z.object({
  jobs: z.object({
    total: z.number(),
    last24h: z.number(),
    byStatus: z.record(z.string(), z.number()),
  }),
  users: z.object({ total: z.number(), active: z.number(), suspended: z.number() }),
  sources: z.object({ total: z.number(), enabled: z.number() }),
  auditsLast24h: z.number(),
});

/**
 * Admin resources (§76–§79): every route requires an MFA-verified session;
 * mutations additionally require an owner/admin role and leave an audit row.
 */
export async function registerAdminResourceRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/admin/overview',
    {
      schema: {
        description: 'Platform counts for the admin dashboard.',
        response: { 200: OverviewSchema, ...errorResponses(401, 403) },
      },
    },
    async (req) => {
      requireAdmin(req);
      return getOverview(getDb());
    },
  );

  app.get(
    '/admin/jobs',
    {
      schema: {
        description: 'All download jobs, newest first (cursor paginated).',
        querystring: JobsQuery,
        response: {
          200: z.object({ data: z.array(JobSchema), nextCursor: z.string().nullable() }),
          ...errorResponses(400, 401, 403),
        },
      },
    },
    async (req) => {
      requireAdmin(req);
      return listJobs(getDb(), req.query);
    },
  );

  app.get(
    '/admin/jobs/:id',
    {
      schema: {
        description: 'A single download job.',
        params: IdParams,
        response: { 200: JobSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (req) => {
      requireAdmin(req);
      return getJob(getDb(), req.params.id);
    },
  );

  app.post(
    '/admin/jobs/:id/cancel',
    {
      schema: {
        description: 'Force-cancel a job (owner/admin only).',
        params: IdParams,
        response: { 200: JobSchema, ...errorResponses(401, 403, 404, 409) },
      },
    },
    async (req) => {
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const job = await cancelJob(db, req.params.id);
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'job.cancel',
        resource: 'download_jobs',
        resourceId: job.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { status: job.status },
      });
      return job;
    },
  );

  app.post(
    '/admin/jobs/:id/retry',
    {
      schema: {
        description: 'Requeue a failed/dead-lettered/restricted job (owner/admin only).',
        params: IdParams,
        response: { 200: JobSchema, ...errorResponses(401, 403, 404, 409, 503) },
      },
    },
    async (req) => {
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const job = await retryJob(db, req.params.id);
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'job.retry',
        resource: 'download_jobs',
        resourceId: job.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      return job;
    },
  );

  app.get(
    '/admin/sources',
    {
      schema: {
        description: 'All download sources with policy fields.',
        response: { 200: z.object({ data: z.array(SourceSchema) }), ...errorResponses(401, 403) },
      },
    },
    async (req) => {
      requireAdmin(req);
      return { data: await listSources(getDb()) };
    },
  );

  app.get(
    '/admin/sources/:id',
    {
      schema: {
        description: 'A single download source.',
        params: IdParams,
        response: { 200: SourceSchema, ...errorResponses(401, 403, 404) },
      },
    },
    async (req) => {
      requireAdmin(req);
      return getSource(getDb(), req.params.id);
    },
  );

  app.patch(
    '/admin/sources/:id',
    {
      schema: {
        description:
          'Update source policy (enabled/mode/formats). Takes effect immediately — no redeploy.',
        params: IdParams,
        body: SourcePatchBody,
        response: { 200: SourceSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const source = await updateSource(db, req.params.id, req.body);
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'source.update',
        resource: 'download_sources',
        resourceId: source.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { ...req.body, slug: source.slug },
      });
      return source;
    },
  );

  app.get(
    '/admin/users',
    {
      schema: {
        description: 'All user accounts, newest first (cursor paginated).',
        querystring: PageQuery,
        response: {
          200: z.object({ data: z.array(UserSchema), nextCursor: z.string().nullable() }),
          ...errorResponses(400, 401, 403),
        },
      },
    },
    async (req) => {
      requireAdmin(req);
      return listUsers(getDb(), req.query);
    },
  );

  app.patch(
    '/admin/users/:id',
    {
      schema: {
        description: 'Activate or suspend a user account (owner/admin only).',
        params: IdParams,
        body: UserPatchBody,
        response: { 200: UserSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (req) => {
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const user = await updateUser(db, req.params.id, req.body);
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'user.update',
        resource: 'users',
        resourceId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { status: req.body.status },
      });
      return user;
    },
  );

  app.get(
    '/admin/audit-logs',
    {
      schema: {
        description: 'Admin audit trail, newest first.',
        querystring: AuditsQuery,
        response: {
          200: z.object({ data: z.array(AuditSchema), nextCursor: z.string().nullable() }),
          ...errorResponses(400, 401, 403),
        },
      },
    },
    async (req) => {
      requireAdmin(req);
      return listAuditLogs(getDb(), req.query);
    },
  );

  app.get(
    '/admin/flags',
    {
      schema: {
        description: 'Feature flags.',
        response: { 200: z.object({ data: z.array(FlagSchema) }), ...errorResponses(401, 403) },
      },
    },
    async (req) => {
      requireAdmin(req);
      return { data: await listFlags(getDb()) };
    },
  );

  app.patch(
    '/admin/flags/:key',
    {
      schema: {
        description: 'Enable/disable a feature flag or set its rollout percentage.',
        params: KeyParams,
        body: FlagPatchBody,
        response: { 200: FlagSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (req) => {
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const flag = await updateFlag(db, req.params.key, req.body);
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'flag.update',
        resource: 'feature_flags',
        resourceId: flag.key,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { ...req.body },
      });
      return flag;
    },
  );

  app.get(
    '/admin/settings',
    {
      schema: {
        description: 'System settings.',
        response: { 200: z.object({ data: z.array(SettingSchema) }), ...errorResponses(401, 403) },
      },
    },
    async (req) => {
      requireAdmin(req);
      return { data: await listSettings(getDb()) };
    },
  );

  app.patch(
    '/admin/settings/:key',
    {
      schema: {
        description: 'Set a system setting value.',
        params: KeyParams,
        body: SettingPatchBody,
        response: { 200: SettingSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (req) => {
      const context = requireAdmin(req);
      assertMutatorRole(context);
      const db = getDb();
      const setting = await updateSetting(db, req.params.key, req.body.value, context.admin.id);
      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'setting.update',
        resource: 'system_settings',
        resourceId: setting.key,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { key: setting.key },
      });
      return setting;
    },
  );
}
