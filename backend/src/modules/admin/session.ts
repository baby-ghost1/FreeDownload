import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { adminMfaRequired, config } from '../../server/config.js';
import { AppError } from '../../errors/app-error.js';
import type { Database } from '../../database/client.js';
import {
  adminSessions,
  adminUsers,
  type AdminSession,
  type AdminUser,
} from '../../database/schema/index.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { issueCsrfToken, setCsrfCookie } from '../../security/csrf.js';

/**
 * Admin sessions (§75): separate `fd_admin` cookie, short TTL, and `mfa_ok`
 * gating - everything beyond login/MFA enrollment requires a verified session.
 */
export interface AdminContext {
  admin: AdminUser;
  session: AdminSession;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the session hook when a valid `fd_admin` cookie is present. */
    adminAuth: AdminContext | null;
  }
}

interface CreatedAdminSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createAdminSession(
  db: Database,
  adminId: string,
  meta: { ip?: string | undefined; userAgent?: string | undefined },
  mfaOk = false,
): Promise<CreatedAdminSession> {
  const token = randomToken(32);
  const csrfToken = issueCsrfToken();
  const expiresAt = new Date(Date.now() + config.admin.ttlSeconds * 1000);

  await db.insert(adminSessions).values({
    adminId,
    tokenHash: sha256(token),
    csrfToken,
    mfaOk,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
    expiresAt,
  });

  return { token, csrfToken, expiresAt };
}

export function setAdminSessionCookies(
  reply: FastifyReply,
  session: { token: string; csrfToken: string; expiresAt: Date },
): void {
  reply.setCookie(config.admin.cookieName, session.token, {
    path: '/',
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    expires: session.expiresAt,
    signed: config.session.secret.length > 0,
  });
  // The double-submit cookie is shared with user sessions - whichever login
  // ran last owns it, and assertCsrf only ever compares cookie vs header.
  setCsrfCookie(reply, session.csrfToken);
}

export function readAdminSessionToken(req: FastifyRequest): string | undefined {
  const raw = req.cookies?.[config.admin.cookieName];
  if (!raw) return undefined;
  if (config.session.secret.length === 0) return raw;

  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && typeof unsigned.value === 'string' ? unsigned.value : undefined;
}

export function clearAdminSessionCookies(reply: FastifyReply): void {
  // Only the admin cookie is cleared - fd_csrf may still belong to a user
  // session opened in the same browser.
  reply.clearCookie(config.admin.cookieName, {
    path: '/',
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
  });
}

/** Resolves the raw `fd_admin` cookie, enforcing revocation/expiry/IP policy. */
export async function loadAdminSession(
  db: Database,
  token: string | undefined,
  currentIp?: string,
): Promise<AdminContext | null> {
  if (!token) return null;

  const rows = await db
    .select({ session: adminSessions, admin: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.adminId, adminUsers.id))
    .where(eq(adminSessions.tokenHash, sha256(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.session.revokedAt !== null || row.session.expiresAt.getTime() <= Date.now()) return null;
  if (!row.admin.active) return null;

  const allowlist = Array.isArray(row.admin.ipAllowlist) ? row.admin.ipAllowlist : [];
  if (allowlist.length > 0 && currentIp !== undefined && !allowlist.includes(currentIp)) {
    return null;
  }

  return { session: row.session, admin: row.admin };
}

/** Slides `last_seen_at` at most once a minute - mirrors user sessions. */
export async function touchAdminSession(db: Database, session: AdminSession): Promise<void> {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  if (session.lastSeenAt.getTime() > oneMinuteAgo.getTime()) return;

  await db
    .update(adminSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(adminSessions.id, session.id));
}

export async function revokeAdminSession(db: Database, session: AdminSession): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(adminSessions.id, session.id), isNull(adminSessions.revokedAt)));
}

/** At most 50 live admin sessions per admin - oldest beyond that are revoked. */
export const MAX_ADMIN_SESSIONS = 50;

export async function enforceAdminSessionLimit(db: Database, adminId: string): Promise<void> {
  const rows = await db
    .select({ id: adminSessions.id })
    .from(adminSessions)
    .where(
      and(
        eq(adminSessions.adminId, adminId),
        isNull(adminSessions.revokedAt),
      ),
    )
    .orderBy(desc(adminSessions.createdAt))
    .limit(MAX_ADMIN_SESSIONS + 1);
  if (rows.length <= MAX_ADMIN_SESSIONS) return;
  const overflow = rows.slice(MAX_ADMIN_SESSIONS);
  for (const row of overflow) {
    await db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminSessions.id, row.id), isNull(adminSessions.revokedAt)));
  }
}

export interface AdminSessionView {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

/** Live (non-revoked, non-expired) sessions for the devices UI, newest first. */
export async function listAdminSessions(
  db: Database,
  adminId: string,
): Promise<AdminSessionView[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: adminSessions.id,
      ip: adminSessions.ip,
      userAgent: adminSessions.userAgent,
      lastSeenAt: adminSessions.lastSeenAt,
      expiresAt: adminSessions.expiresAt,
      createdAt: adminSessions.createdAt,
    })
    .from(adminSessions)
    .where(and(eq(adminSessions.adminId, adminId), isNull(adminSessions.revokedAt)))
    .orderBy(desc(adminSessions.createdAt))
    .limit(MAX_ADMIN_SESSIONS);
  return rows.filter((r) => r.expiresAt.getTime() > now.getTime());
}

/** Convenience for routes: authenticated admin or the §46 envelope. */
export function requireAdmin(
  req: FastifyRequest,
  opts: { allowUnmfa?: boolean } = {},
): AdminContext {
  const context = req.adminAuth;
  if (!context) {
    throw new AppError('UNAUTHORIZED', 'Admin authentication is required.');
  }
  if (!opts.allowUnmfa && adminMfaRequired() && !context.session.mfaOk) {
    throw new AppError('FORBIDDEN', 'Complete MFA enrollment to continue.', {
      details: { mfaRequired: true },
    });
  }
  return context;
}

const MUTATOR_ROLES = ['owner', 'admin'] as const;

/** Only owner/admin may mutate platform state; support/viewer stay read-only. */
export function assertMutatorRole(context: AdminContext): void {
  if (!MUTATOR_ROLES.includes(context.admin.role as (typeof MUTATOR_ROLES)[number])) {
    throw new AppError('FORBIDDEN', 'Your role cannot perform this action.');
  }
}
