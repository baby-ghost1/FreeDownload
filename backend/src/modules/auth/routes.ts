import { z } from 'zod';

import { config } from '../../server/config.js';
import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { verifyTurnstile } from '../../security/turnstile.js';
import { assertCsrf } from '../../security/csrf.js';
import {
  changePassword,
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  toPublicUser,
  verifyEmail,
} from './service.js';
import {
  clearSessionCookies,
  createSession,
  requireAuth,
  revokeSession,
  setSessionCookies,
} from './session.js';

const EmailSchema = z.email('Enter a valid email address.');
const PasswordSchema = z.string().min(8, 'Password must be at least 8 characters.').max(256);

const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  status: z.enum(['pending', 'active', 'suspended', 'deleted']),
  emailVerifiedAt: z.date().nullable(),
  createdAt: z.date(),
});

const SessionResponseSchema = z.object({
  user: PublicUserSchema,
  csrfToken: z.string(),
});

const OkSchema = z.object({ ok: z.literal(true) });

const RegisterBody = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: z.string().max(80).optional(),
  turnstileToken: z.string().optional(),
});

const LoginBody = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(256),
});

const TokenBody = z.object({ token: z.string().min(16).max(256) });

const ForgotBody = z.object({ email: EmailSchema, turnstileToken: z.string().optional() });

const ResetBody = z.object({ token: z.string().min(16).max(256), password: PasswordSchema });

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: PasswordSchema,
});

/**
 * Authentication endpoints (contract §35–§37).
 *
 * All cookie-authenticated mutations require the double-submit CSRF header;
 * registration and recovery also verify the Turnstile token in production.
 * Rate limits are per-route, on top of the global limiter (§25).
 */
export async function registerAuthRoutes(app: AppInstance): Promise<void> {
  const authRateLimit = {
    rateLimit: {
      max: config.rateLimit.authMax,
      timeWindow: `${config.rateLimit.windowSec} seconds`,
    },
  } as const;

  app.post(
    '/auth/register',
    {
      config: authRateLimit,
      schema: {
        description: 'Create an account, start a session and send a verification email.',
        body: RegisterBody,
        response: { 201: SessionResponseSchema },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const { email, password, displayName, turnstileToken } = req.body;

      await verifyTurnstile(turnstileToken, req.ip);

      const user = await registerUser({ email, password, displayName, ip: req.ip });
      const session = await createSession(db, user.id, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      setSessionCookies(reply, session);

      return reply.status(201).send({ user: toPublicUser(user), csrfToken: session.csrfToken });
    },
  );

  app.post(
    '/auth/login',
    {
      config: authRateLimit,
      schema: {
        description: 'Exchange credentials for a session cookie.',
        body: LoginBody,
        response: { 200: SessionResponseSchema },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const user = await loginUser({
        email: req.body.email,
        password: req.body.password,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const session = await createSession(db, user.id, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      setSessionCookies(reply, session);

      return reply.send({ user: toPublicUser(user), csrfToken: session.csrfToken });
    },
  );

  app.post(
    '/auth/logout',
    {
      config: authRateLimit,
      schema: { description: 'Revoke the current session.', response: { 200: OkSchema } },
    },
    async (req, reply) => {
      assertCsrf(req);
      const auth = requireAuth(req);
      await revokeSession(getDb(), auth.session);
      clearSessionCookies(reply);
      return reply.send({ ok: true as const });
    },
  );

  app.post(
    '/auth/verify-email',
    {
      config: authRateLimit,
      schema: {
        description: 'Consume an emailed verification token.',
        body: TokenBody,
        response: { 200: OkSchema },
      },
    },
    async (req, reply) => {
      await verifyEmail(req.body.token, getDb());
      return reply.send({ ok: true as const });
    },
  );

  app.post(
    '/auth/forgot-password',
    {
      config: authRateLimit,
      schema: {
        description: 'Request a password reset link (never reveals whether the account exists).',
        body: ForgotBody,
        response: { 200: OkSchema },
      },
    },
    async (req, reply) => {
      await verifyTurnstile(req.body.turnstileToken, req.ip);
      await requestPasswordReset(req.body.email, getDb());
      return reply.send({ ok: true as const });
    },
  );

  app.post(
    '/auth/reset-password',
    {
      config: authRateLimit,
      schema: {
        description: 'Set a new password with a reset token and revoke all sessions.',
        body: ResetBody,
        response: { 200: OkSchema },
      },
    },
    async (req, reply) => {
      await resetPassword(req.body.token, req.body.password, getDb());
      clearSessionCookies(reply);
      return reply.send({ ok: true as const });
    },
  );

  app.post(
    '/me/password',
    {
      config: authRateLimit,
      schema: {
        description: 'Change password for the signed-in user; other sessions are revoked.',
        body: ChangePasswordBody,
        response: { 200: OkSchema },
      },
    },
    async (req, reply) => {
      assertCsrf(req);
      const auth = requireAuth(req);
      await changePassword(
        auth.user.id,
        req.body.currentPassword,
        req.body.newPassword,
        auth.session.id,
        getDb(),
      );
      return reply.send({ ok: true as const });
    },
  );
}
