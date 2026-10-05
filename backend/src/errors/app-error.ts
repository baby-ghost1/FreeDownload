/**
 * Typed application error (contract §46).
 *
 * Only `code`, `message` and `requestId` reach the client - internals stay in
 * logs. Every throw site uses one of these or an unexpected-error wrapper.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_SOURCE'
  | 'POLICY_RESTRICTED'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNSUPPORTED_SOURCE: 422,
  POLICY_RESTRICTED: 403,
  PAYLOAD_TOO_LARGE: 413,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown> | undefined;
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      cause?: unknown;
      statusCode?: number;
      expose?: boolean;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = options?.statusCode ?? STATUS_BY_CODE[code];
    this.details = options?.details;
    // Only errors we deliberately author are safe to surface verbatim.
    this.expose = options?.expose ?? this.statusCode < 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
