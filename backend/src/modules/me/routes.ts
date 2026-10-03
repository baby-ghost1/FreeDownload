import { z } from 'zod';

import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { AppError } from '../../errors/app-error.js';
import { assertCsrf } from '../../security/csrf.js';
import { downloadJobs, sessions, users } from '../../database/schema/index.js';
import { toPublicUser } from '../auth/service.js';
import { clearSessionCookies, requireAuth } from '../auth/session.js';
import { errorResponses } from '../../http/error-schema.js';

const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  status: z.enum(['pending', 'active', 'suspended', 'deleted']),
  emailVerifiedAt: z.date().nullable(),
  createdAt: z.date(),
});

const PatchMeBody = z.object({ displayName: z.string().min(1).max(80).optional() });

const UsageQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

const UsageDay = z.object({
  day: z.string(),
  count: z.number(),
  completed: z.number(),
  failed: z.number(),
});

const UsageSchema = z.object({
  days: z.number(),
  total: z.number(),
  completed: z.number(),
  failed: z.number(),
  byDay: z.array(UsageDay),
});

const SessionSchema = z.object({
  id: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
  lastSeenAt: z.date(),
  expiresAt: z.date(),
  createdAt: z.date(),
});

const SessionListSchema = z.object({ data: z.array(SessionSchema) });

const SessionParams = z.object({ id: z.uuid('A valid id is required.') });

const OkSchema = z.object({ ok: z.literal(true) });

const DAY_MS = 86_400_000;

/** Account self-service: profile, usage, sessions (contract §37). */
export async function registerMeRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/me',
    {
      schema: {
        description: 'Current session user.',
        response: { 200: MeSchema, ...errorResponses(401) },
      },
    },
    async (req) => {
      const auth = requireAuth(req);
      return toPublicUser(auth.user);
    },
  );

  app.patch(
    '/me',
    {
      schema: {
        description: 'Update the signed-in user profile.',
        body: PatchMeBody,
        response: { 200: MeSchema },
      },
    },
    async (req) => {
      assertCsrf(req);
      const auth = requireAuth(req);

      const updated = await getDb()
        .update(users)
        .set({ displayName: req.body.displayName ?? null })
        .where(eq(users.id, auth.user.id))
        .returning();

      return toPublicUser(updated[0]!);
    },
  );

  app.get(
    '/me/usage',
    {
      schema: {
        description: 'Daily job counts for the signed-in user over the last N days.',
        querystring: UsageQuery,
        response: { 200: UsageSchema, ...errorResponses(400, 401) },
      },
    },
    async (req) => {
      const auth = requireAuth(req);
      const { days } = req.query;
      const since = new Date(Date.now() - days * DAY_MS);

      const dayExpr = sql<string>`to_char(date_trunc('day', ${downloadJobs.createdAt}), 'YYYY-MM-DD')`;
      const rows = await getDb()
        .select({ day: dayExpr, status: downloadJobs.status, n: count() })
        .from(downloadJobs)
        .where(and(eq(downloadJobs.userId, auth.user.id), gte(downloadJobs.createdAt, since)))
        .groupBy(dayExpr, downloadJobs.status);

      const byDay = new Map<string, { count: number; completed: number; failed: number }>();
      let total = 0;
      let completed = 0;
      let failed = 0;
      for (const row of rows) {
        const bucket = byDay.get(row.day) ?? { count: 0, completed: 0, failed: 0 };
        bucket.count += row.n;
        if (row.status === 'completed') {
          bucket.completed += row.n;
          completed += row.n;
        }
        if (row.status === 'failed' || row.status === 'dead_letter') {
          bucket.failed += row.n;
          failed += row.n;
        }
        byDay.set(row.day, bucket);
        total += row.n;
      }

      return {
        days,
        total,
        completed,
        failed,
        byDay: [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, bucket]) => ({ day, ...bucket })),
      };
    },
  );

  app.get(
    '/me/sessions',
    {
      schema: {
        description: 'Active sessions for the signed-in user.',
        response: { 200: SessionListSchema, ...errorResponses(401) },
      },
    },
    async (req) => {
      const auth = requireAuth(req);
      const now = new Date();

      const rows = await getDb()
        .select({
          id: sessions.id,
          ip: sessions.ip,
          userAgent: sessions.userAgent,
          lastSeenAt: sessions.lastSeenAt,
          expiresAt: sessions.expiresAt,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, auth.user.id),
            isNull(sessions.revokedAt),
            sql`${sessions.expiresAt} > ${now}`,
          ),
        )
        .orderBy(desc(sessions.lastSeenAt))
        .limit(50);

      return {
        data: rows.map((row) => ({
          ...row,
          current: row.id === auth.session.id,
        })),
      };
    },
  );

  app.delete(
    '/me/sessions/:id',
    {
      schema: {
        description: 'Revoke one of your own sessions.',
        params: SessionParams,
        response: { 200: OkSchema, ...errorResponses(401, 404) },
      },
    },
    async (req, reply) => {
      assertCsrf(req);
      const auth = requireAuth(req);

      const revoked = await getDb()
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.id, req.params.id),
            eq(sessions.userId, auth.user.id),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ id: sessions.id });

      if (revoked.length === 0) {
        throw new AppError('NOT_FOUND', 'Session not found.');
      }

      // Revoking the session you are using also drops the cookies.
      if (req.params.id === auth.session.id) {
        clearSessionCookies(reply);
      }

      return reply.send({ ok: true as const });
    },
  );
}
