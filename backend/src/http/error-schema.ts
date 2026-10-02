import { z } from 'zod';

/** The §46 error envelope — one definition reused by every error response. */
export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'UNSUPPORTED_SOURCE',
  'POLICY_RESTRICTED',
  'PAYLOAD_TOO_LARGE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

/** Commonly paired with a route's success schema. */
export const UnauthorizedSchema = ErrorEnvelopeSchema;

export function errorResponses(...statuses: number[]): Record<number, typeof ErrorEnvelopeSchema> {
  return Object.fromEntries(statuses.map((s) => [s, ErrorEnvelopeSchema]));
}
