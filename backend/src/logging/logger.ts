import { pino, type Logger } from 'pino';
import { config } from '../server/config.js';

/**
 * Structured JSON logging (contract §22).
 *
 * Redaction list: never log credentials, tokens or cookies even if a caller
 * passes them by mistake. `url` is redacted because user-submitted URLs are
 * potentially personal data (contract §51).
 */
const REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'tokenHash',
  'apiKey',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'sessionToken',
  'url',
  'urlRedacted',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.authorization',
  '*.cookie',
  '*.url',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

// Pretty-printing spawns a worker thread — never do it in tests (open handles)
// or production (JSON only).
const devTransport =
  config.isProduction || config.isTest
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      };

/** Single source of truth so tests can assert the exact production redaction. */
export const REDACT_OPTIONS = { paths: REDACT_PATHS, censor: '[REDACTED]' } as const;

export const logger: Logger = pino({
  level: config.logLevel,
  base: { service: config.serviceName, env: config.env },
  redact: REDACT_OPTIONS,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(devTransport ? { transport: devTransport } : {}),
});

export type { Logger };
