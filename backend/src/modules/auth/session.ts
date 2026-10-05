import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../../server/config.js';
import { AppError } from '../../errors/app-error.js';
import type { Database } from '../../database/client.js';
import { sessions, users, type Session, type User } from '../../database/schema/index.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { issueCsrfToken, setCsrfCookie } from '../../security/csrf.js';
import { eq, and, isNull, gt, ne } from 'drizzle-orm';

export interface AuthContext {
  user: User;
  session: Session;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the session hook when a valid session cookie is present. */
    auth: AuthContext | null;
  }
}

interface CreatedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

/** Issues a new session row and returns the values that must reach the browser. */
export async function createSession(
  db: Database,
  userId: string,
  meta: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<CreatedSession> {
  const token = randomToken(32);
  const csrfToken = issueCsrfToken();
  const expiresAt = new Date(Date.now() + config.session.ttlSeconds * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    csrfToken,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
    expiresAt,
  });

  return { token, csrfToken, expiresAt };
}

export function setSessionCookies(
  reply: FastifyReply,
  session: { token: string; csrfToken: string; expiresAt: Date },
): void {
  reply.setCookie(config.session.cookieName, session.token, {
    path: '/',
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    expires: session.expiresAt,
    signed: config.session.secret.length > 0,
  });
  setCsrfCookie(reply, session.csrfToken);
}

/** Reads the session cookie, verifying the signature when one is configured. */
export function readSessionToken(req: FastifyRequest): string | undefined {
  const raw = req.cookies?.[config.session.cookieName];
  if (!raw) return undefined;
  if (config.session.secret.length === 0) return raw;

  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && typeof unsigned.value === 'string' ? unsigned.value : undefined;
}

export function clearSessionCookies(reply: FastifyReply): void {
  const base = {
    path: '/',
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
  } as const;
  reply.clearCookie(config.session.cookieName, base);
  reply.clearCookie(config.session.csrfCookieName, { ...base, httpOnly: false });
}

/** Resolves the raw cookie value to a session, enforcing revocation/expiry. */
export async function loadSession(
  db: Database,
  token: string | undefined,
): Promise<AuthContext | null> {
  if (!token) return null;

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  if (row.session.revokedAt !== null || row.session.expiresAt.getTime() <= now) return null;
  if (row.user.deletedAt !== null || row.user.status === 'suspended') return null;

  return { session: row.session, user: row.user };
}

/** Slides `last_seen_at` at most once a minute to avoid a write per request. */
export async function touchSession(db: Database, session: Session): Promise<void> {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  if (session.lastSeenAt.getTime() > oneMinuteAgo.getTime()) return;

  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, session.id));
}

export async function revokeSession(db: Database, session: Session): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)));
}

/** Used after a password change: every other session is invalidated. */
export async function revokeOtherSessions(
  db: Database,
  userId: string,
  keepSessionId: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        ne(sessions.id, keepSessionId),
      ),
    );
}

/** Convenience for routes: authenticate or throw the §46 envelope. */
export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) {
    throw new AppError('UNAUTHORIZED', 'Authentication is required.');
  }
  return req.auth;
}
