import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../server/config.js';
import { AppError } from '../errors/app-error.js';
import { safeEqual, randomToken } from '../utils/crypto.js';

/**
 * CSRF protection (contract §14).
 *
 * Double-submit: the session row holds a CSRF token, mirrored into a
 * JS-readable cookie. Cookie-authenticated mutations must echo it back in
 * `X-CSRF-Token`. Bearer (API key) clients are exempt — they are immune to
 * ambient-credential CSRF by design.
 */
export function issueCsrfToken(): string {
  // 24 random bytes → unguessable, mirrors the session token format.
  return randomToken(24);
}

export function setCsrfCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(config.session.csrfCookieName, token, {
    path: '/',
    httpOnly: false, // must be readable by the frontend to echo it back
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    maxAge: config.session.ttlSeconds,
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function assertCsrf(req: FastifyRequest): void {
  if (SAFE_METHODS.has(req.method)) return;

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) return;

  const cookieToken = req.cookies?.[config.session.csrfCookieName];
  const headerToken = req.headers[config.session.csrfHeaderName];

  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    !safeEqual(cookieToken, headerToken)
  ) {
    throw new AppError('FORBIDDEN', 'Invalid or missing CSRF token.');
  }
}
