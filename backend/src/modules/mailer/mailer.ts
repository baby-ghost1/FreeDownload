import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../../server/config.js';
import { logger } from '../../logging/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  /** Text body. Links are built absolute against APP_URL. */
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development transport: renders the message to the log so links are
 * clickable in the console. Never used in production.
 */
class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, transport: 'console' },
      'mail (development only):\n%s',
      message.text,
    );
  }
}

/**
 * SMTP is wired in a later phase (Phase 5) when outbound email ships. Until
 * then production must fail loudly rather than silently dropping emails.
 */
class UnimplementedMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    throw new Error(
      `SMTP transport is not configured (attempted to send "${message.subject}" to ${message.to}).`,
    );
  }
}

let mailer: Mailer | undefined;

/** Swap the transport (tests capture messages instead of logging them). */
export function setMailer(next: Mailer | undefined): void {
  mailer = next;
}

export function getMailer(): Mailer {
  if (!mailer) {
    mailer = config.email.transport === 'smtp' ? new UnimplementedMailer() : new ConsoleMailer();
    if (config.isProduction && config.email.transport === 'console') {
      logger.warn('MAIL_TRANSPORT=console in production - emails are logged, not delivered');
    }
  }
  return mailer;
}

export function verificationEmail(to: string, token: string): MailMessage {
  const link = `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Confirm your FreeDownload account',
    text: [
      'Welcome to FreeDownload!',
      '',
      'Confirm your email address by opening this link:',
      link,
      '',
      `This link expires in ${config.tokens.verifyTtlHours} hour(s).`,
      '',
      'If you did not create an account, you can ignore this email.',
    ].join('\n'),
  };
}

export function passwordResetEmail(to: string, token: string): MailMessage {
  const link = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Reset your FreeDownload password',
    text: [
      'We received a request to reset your password.',
      '',
      'Open this link to choose a new one:',
      link,
      '',
      `This link expires in ${config.tokens.resetTtlMinutes} minutes and can be used once.`,
      '',
      'If you did not request this, you can safely ignore this email.',
    ].join('\n'),
  };
}

/** Small helper so handlers stay readable. */
export function clientIp(req: FastifyRequest): string | undefined {
  return req.ip;
}

export function setNoStore(reply: FastifyReply): void {
  reply.header('cache-control', 'no-store');
}
