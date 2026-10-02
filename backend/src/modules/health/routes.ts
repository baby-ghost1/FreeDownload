import { z } from 'zod';

import { readinessRegistry } from './readiness.js';
import { config } from '../../server/config.js';
import type { AppInstance } from '../../types/app.js';

const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  uptimeSec: z.number(),
});

const ReadySchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.enum(['pass', 'fail', 'skipped'])),
});

/**
 * Liveness = process is up. Readiness = dependencies are usable.
 * Neither reveals infrastructure details (contract §43).
 */
export async function registerHealthRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        description: 'Liveness probe — process is running.',
        response: { 200: HealthSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: config.serviceName,
      uptimeSec: Math.round(process.uptime()),
    }),
  );

  app.get(
    '/ready',
    {
      schema: {
        description: 'Readiness probe — dependency health.',
        response: { 200: ReadySchema, 503: ReadySchema },
      },
    },
    async (_req, reply) => {
      const { ready, checks } = await readinessRegistry.run();
      const body = {
        status: (ready ? 'ready' : 'not_ready') as 'ready' | 'not_ready',
        checks,
      };
      return reply.status(ready ? 200 : 503).send(body);
    },
  );
}
