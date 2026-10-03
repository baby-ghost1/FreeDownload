import { z } from 'zod';
import { eq } from 'drizzle-orm';

import { config } from '../../server/config.js';
import { getDb } from '../../database/client.js';
import { AppError } from '../../errors/app-error.js';
import type { AppInstance } from '../../types/app.js';
import { assertCsrf } from '../../security/csrf.js';
import { verifyPassword } from '../../security/passwords.js';
import { normalizeEmail } from '../../utils/crypto.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../security/totp.js';
import { adminSessions, adminUsers } from '../../database/schema/index.js';
import { errorResponses } from '../../http/error-schema.js';
import { writeAudit } from './audit.js';
import { openTotpSecret, sealTotpSecret } from './secret-box.js';
import { registerAdminResourceRoutes } from './resources.js';
import {
  clearAdminSessionCookies,
  createAdminSession,
  requireAdmin,
  revokeAdminSession,
  setAdminSessionCookies,
} from './session.js';

const RoleSchema = z.enum(['owner', 'admin', 'support', 'viewer']);

const AdminSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: RoleSchema,
  active: z.boolean(),
});

const LoginBody = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1).max(256),
  code: z
    .string()
    .regex(/^\d{6}$/, 'Six-digit code.')
    .optional(),
});

const LoginResponse = z.object({
  admin: AdminSchema,
  csrfToken: z.string(),
  mfaEnrolled: z.boolean(),
  mfaOk: z.boolean(),
});

const MeResponse = z.object({ admin: AdminSchema, mfaOk: z.boolean() });

const MfaCompleteBody = z.object({ code: z.string().regex(/^\d{6}$/, 'Six-digit code.') });

const MfaSetupResponse = z.object({ secret: z.string(), otpauthUrl: z.string() });

const OkSchema = z.object({ ok: z.literal(true) });

function toAdmin(admin: {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'support' | 'viewer';
  active: boolean;
}) {
  return { id: admin.id, email: admin.email, role: admin.role, active: admin.active };
}

/**
 * Admin authentication (§75): separate cookie, TOTP MFA, rate-limited login,
 * audit entry per mutation. MFA enrollment is forced before any other admin
 * route accepts the session.
 */
export async function registerAdminRoutes(app: AppInstance): Promise<void> {
  const authRateLimit = {
    rateLimit: {
      max: config.rateLimit.authMax,
      timeWindow: `${config.rateLimit.windowSec} seconds`,
    },
  } as const;

  app.post(
    '/admin/auth/login',
    {
      config: authRateLimit,
      schema: {
        description: 'Exchange admin credentials (and TOTP code) for a session.',
        body: LoginBody,
        response: { 200: LoginResponse, ...errorResponses(401, 429) },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const email = normalizeEmail(req.body.email);

      const rows = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
      const admin = rows[0];

      // Always run a verification so unknown emails and bad passwords cost
      // the same (timing oracle).
      const passwordOk = await verifyPassword(admin?.passwordHash ?? '', req.body.password);
      if (!admin || !admin.active || !passwordOk) {
        throw new AppError('UNAUTHORIZED', 'Invalid admin credentials.');
      }

      const allowlist = Array.isArray(admin.ipAllowlist) ? admin.ipAllowlist : [];
      if (allowlist.length > 0 && !allowlist.includes(req.ip)) {
        throw new AppError('UNAUTHORIZED', 'Sign-in is not allowed from this address.');
      }

      const mfaEnrolled = admin.totpSecretEnc !== null;
      let mfaOk = false;
      if (mfaEnrolled) {
        if (!req.body.code) {
          throw new AppError('UNAUTHORIZED', 'Two-factor code required.', {
            details: { mfaRequired: true },
          });
        }
        if (!verifyTotp(openTotpSecret(admin.totpSecretEnc!), req.body.code)) {
          throw new AppError('UNAUTHORIZED', 'Two-factor code is incorrect.');
        }
        mfaOk = true;
      }

      const session = await createAdminSession(
        db,
        admin.id,
        { ip: req.ip, userAgent: req.headers['user-agent'] },
        mfaOk,
      );
      setAdminSessionCookies(reply, session);

      await db
        .update(adminUsers)
        .set({ lastLoginAt: new Date() })
        .where(eq(adminUsers.id, admin.id));

      await writeAudit(db, {
        adminId: admin.id,
        action: 'admin.login',
        resource: 'admin_users',
        resourceId: admin.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        metadata: { mfa: mfaOk },
      });

      return {
        admin: toAdmin(admin),
        csrfToken: session.csrfToken,
        mfaEnrolled,
        mfaOk,
      };
    },
  );

  app.post(
    '/admin/auth/logout',
    {
      config: authRateLimit,
      schema: {
        description: 'Revoke the current admin session.',
        response: { 200: OkSchema, ...errorResponses(401, 403) },
      },
    },
    async (req, reply) => {
      assertCsrf(req);
      const context = requireAdmin(req, { allowUnmfa: true });
      await revokeAdminSession(getDb(), context.session);
      clearAdminSessionCookies(reply);
      await writeAudit(getDb(), {
        adminId: context.admin.id,
        action: 'admin.logout',
        resource: 'admin_users',
        resourceId: context.admin.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      return reply.send({ ok: true as const });
    },
  );

  app.get(
    '/admin/auth/me',
    {
      schema: {
        description: 'Current admin session probe (works before MFA enrollment).',
        response: { 200: MeResponse, ...errorResponses(401) },
      },
    },
    async (req) => {
      const context = requireAdmin(req, { allowUnmfa: true });
      return { admin: toAdmin(context.admin), mfaOk: context.session.mfaOk };
    },
  );

  app.post(
    '/admin/auth/mfa/setup',
    {
      schema: {
        description: 'Generate the TOTP secret for this admin (persisted on first use).',
        response: { 200: MfaSetupResponse, ...errorResponses(401, 403, 409) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const context = requireAdmin(req, { allowUnmfa: true });
      const db = getDb();

      if (context.admin.totpSecretEnc !== null) {
        throw new AppError('CONFLICT', 'MFA is already enrolled for this account.');
      }

      const secret = generateTotpSecret();
      await db
        .update(adminUsers)
        .set({ totpSecretEnc: sealTotpSecret(secret) })
        .where(eq(adminUsers.id, context.admin.id));

      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'admin.mfa.setup',
        resource: 'admin_users',
        resourceId: context.admin.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });

      return {
        secret,
        otpauthUrl: otpauthUri({
          account: context.admin.email,
          issuer: 'FreeDownload',
          secret,
        }),
      };
    },
  );

  app.post(
    '/admin/auth/mfa/complete',
    {
      config: authRateLimit,
      schema: {
        description: 'Confirm the authenticator code and upgrade the session to MFA-verified.',
        body: MfaCompleteBody,
        response: { 200: OkSchema, ...errorResponses(400, 401, 403, 409) },
      },
    },
    async (req) => {
      assertCsrf(req);
      const context = requireAdmin(req, { allowUnmfa: true });
      const db = getDb();

      if (context.admin.totpSecretEnc === null) {
        throw new AppError('CONFLICT', 'MFA has not been set up for this account.');
      }
      if (!verifyTotp(openTotpSecret(context.admin.totpSecretEnc), req.body.code)) {
        throw new AppError('VALIDATION_ERROR', 'Two-factor code is incorrect.');
      }

      await db
        .update(adminSessions)
        .set({ mfaOk: true })
        .where(eq(adminSessions.id, context.session.id));

      await writeAudit(db, {
        adminId: context.admin.id,
        action: 'admin.mfa.enrolled',
        resource: 'admin_users',
        resourceId: context.admin.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });

      return { ok: true as const };
    },
  );

  await registerAdminResourceRoutes(app);
}
