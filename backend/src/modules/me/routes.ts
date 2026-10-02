import { z } from 'zod';

import { eq } from 'drizzle-orm';

import { getDb } from '../../database/client.js';
import type { AppInstance } from '../../types/app.js';
import { assertCsrf } from '../../security/csrf.js';
import { users } from '../../database/schema/index.js';
import { toPublicUser } from '../auth/service.js';
import { requireAuth } from '../auth/session.js';
import { errorResponses } from '../../http/error-schema.js';

const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  status: z.enum(['pending', 'active', 'suspended', 'deleted']),
  emailVerifiedAt: z.date().nullable(),
  createdAt: z.date(),
});

const PatchMeBody = z.object({ displayName: z.string().min(1).max(80).optional() });

/** Account self-service: who am I, and profile updates (contract §37). */
export async function registerMeRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/me',
    {
      schema: {
        description: 'Current session user.',
        response: { 200: MeSchema, ...errorResponses(401) },
      },
    },
    async (req) => {
      const auth = requireAuth(req);
      return toPublicUser(auth.user);
    },
  );

  app.patch(
    '/me',
    {
      schema: {
        description: 'Update the signed-in user profile.',
        body: PatchMeBody,
        response: { 200: MeSchema },
      },
    },
    async (req) => {
      assertCsrf(req);
      const auth = requireAuth(req);

      const updated = await getDb()
        .update(users)
        .set({ displayName: req.body.displayName ?? null })
        .where(eq(users.id, auth.user.id))
        .returning();

      return toPublicUser(updated[0]!);
    },
  );
}
