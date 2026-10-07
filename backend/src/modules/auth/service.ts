import { eq, and, isNull, ne, inArray } from 'drizzle-orm';

import { config } from '../../server/config.js';
import { AppError } from '../../errors/app-error.js';
import { logger } from '../../logging/logger.js';
import { getDb, type Database } from '../../database/client.js';
import {
  emailVerifications,
  passwordResets,
  sessions,
  users,
  type User,
} from '../../database/schema/index.js';
import { normalizeEmail, randomToken } from '../../utils/crypto.js';
import { assertPasswordStrength, hashPassword, verifyPassword } from '../../security/passwords.js';
import {
  hashToken,
  issuePasswordResetToken,
  issueVerificationToken,
  isTokenUsable,
} from '../../security/tokens.js';
import { getMailer, passwordResetEmail, verificationEmail } from '../mailer/mailer.js';

/** The only user shape that ever leaves the API (§16). */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  status: User['status'];
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps driver errors in DrizzleQueryError; walk the cause chain.
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if ((current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Verifies a password against a throwaway hash when the account is unknown. */
let dummyHash: Promise<string> | undefined;
async function burnPasswordTime(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomToken(16));
  await verifyPassword(await dummyHash, password);
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export async function registerUser(input: RegisterInput, db: Database = getDb()): Promise<User> {
  const email = normalizeEmail(input.email);
  assertPasswordStrength(input.password);

  const passwordHash = await hashPassword(input.password);

  let created: User;
  try {
    const rows = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        displayName: input.displayName?.trim() || null,
        status: 'pending',
      })
      .returning();
    created = rows[0]!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', 'An account with this email already exists.');
    }
    throw err;
  }

  const { token } = issueVerificationToken();
  await db.insert(emailVerifications).values({
    userId: created.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + config.tokens.verifyTtlHours * 3_600_000),
  });

  await getMailer().send(verificationEmail(email, token));
  logger.info({ userId: created.id }, 'user registered');
  return created;
}

export interface LoginInput {
  email: string;
  password: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export async function loginUser(input: LoginInput, db: Database = getDb()): Promise<User> {
  const email = normalizeEmail(input.email);
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  if (!user || user.deletedAt !== null) {
    // Equalise timing with a real verification so login cannot enumerate users.
    await burnPasswordTime(input.password);
    throw new AppError('UNAUTHORIZED', 'User does not exist.');
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    throw new AppError('UNAUTHORIZED', 'Email or password is incorrect.');
  }

  if (user.status === 'suspended') {
    throw new AppError('FORBIDDEN', 'This account has been suspended.');
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  return { ...user, lastLoginAt: new Date() };
}

export async function verifyEmail(token: string, db: Database = getDb()): Promise<User> {
  const rows = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.tokenHash, hashToken(token)))
    .limit(1);

  const record = rows[0];
  if (!record || !isTokenUsable(record)) {
    throw new AppError('VALIDATION_ERROR', 'This link is invalid or has expired.');
  }

  const now = new Date();
  await db
    .update(emailVerifications)
    .set({ consumedAt: now })
    .where(eq(emailVerifications.id, record.id));

  const updated = await db
    .update(users)
    .set({ emailVerifiedAt: now, status: 'active' })
    .where(eq(users.id, record.userId))
    .returning();

  const user = updated[0];
  if (!user) throw new AppError('NOT_FOUND', 'Account not found.');
  return user;
}

/**
 * Always resolves without revealing whether the address exists (§57).
 * The verification/reset flows themselves are the enumeration barrier.
 */
export async function requestPasswordReset(email: string, db: Database = getDb()): Promise<void> {
  const normalized = normalizeEmail(email);
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.email, normalized),
        isNull(users.deletedAt),
        // Verification is not a prerequisite for recovering your own account.
        inArray(users.status, ['pending', 'active']),
      ),
    )
    .limit(1);

  const user = rows[0];
  if (!user) return;

  // Supersede any outstanding link so only the newest one works.
  await db
    .update(passwordResets)
    .set({ consumedAt: new Date() })
    .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.consumedAt)));

  const { token, tokenHash, expiresAt } = issuePasswordResetToken();
  await db.insert(passwordResets).values({ userId: user.id, tokenHash, expiresAt });

  await getMailer().send(passwordResetEmail(user.email, token));
}

export async function resetPassword(
  token: string,
  newPassword: string,
  db: Database = getDb(),
): Promise<void> {
  assertPasswordStrength(newPassword);

  const rows = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, hashToken(token)))
    .limit(1);

  const record = rows[0];
  if (!record || !isTokenUsable(record)) {
    throw new AppError('VALIDATION_ERROR', 'This link is invalid or has expired.');
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  await db.update(passwordResets).set({ consumedAt: now }).where(eq(passwordResets.id, record.id));
  await db.update(users).set({ passwordHash, status: 'active' }).where(eq(users.id, record.userId));

  // A password change invalidates every existing session (contract §36).
  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.userId, record.userId));

  logger.info({ userId: record.userId }, 'password reset completed');
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId: string,
  db: Database = getDb(),
): Promise<void> {
  assertPasswordStrength(newPassword);

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new AppError('NOT_FOUND', 'Account not found.');

  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) {
    throw new AppError('UNAUTHORIZED', 'Current password is incorrect.');
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));

  // Keep the caller signed in; every other session is invalidated.
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, keepSessionId)),
    );
}

/** Used by `GET /me` - refresh nothing, just return the caller. */
export async function getUserById(id: string, db: Database = getDb()): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}
