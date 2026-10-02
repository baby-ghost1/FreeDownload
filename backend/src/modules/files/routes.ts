import { z } from 'zod';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { config } from '../../server/config.js';
import type { AppInstance } from '../../types/app.js';
import { AppError } from '../../errors/app-error.js';
import { localObjectPath, verifyFileToken } from '../../storage/local.js';

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const KEY_PATTERN = /^jobs\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]{1,120}$/;
const Query = z.object({ exp: z.string(), sig: z.string() });

/**
 * Development/test transport for the `local` storage driver only — production
 * (R2) bypasses this route entirely and browsers stream bytes straight from
 * object storage (contract invariant 5). The HMAC token is the entire
 * authorization: no session, no job lookup, no enumeration surface.
 */
export async function registerFilesRoutes(app: AppInstance): Promise<void> {
  app.get(
    '/files/*',
    {
      schema: {
        description: 'Signed local-file streaming (STORAGE_DRIVER=local only).',
        querystring: Query,
      },
    },
    async (req, reply) => {
      if (config.storage.driver !== 'local') {
        throw new AppError('NOT_FOUND', 'Not found.');
      }

      const params = req.params as Record<string, string | undefined>;
      const key = params['*'];
      if (!key || !KEY_PATTERN.test(key)) {
        throw new AppError('NOT_FOUND', 'Not found.');
      }

      const exp = Number(req.query.exp);
      if (!verifyFileToken(key, exp, req.query.sig)) {
        throw new AppError('FORBIDDEN', 'This link is invalid or has expired.');
      }

      let path: string;
      try {
        path = localObjectPath(key);
      } catch {
        throw new AppError('NOT_FOUND', 'Not found.');
      }

      let size: number;
      try {
        size = (await stat(path)).size;
      } catch {
        throw new AppError('NOT_FOUND', 'This file has been purged.');
      }

      const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
      reply
        .type(MIME_BY_EXT[ext] ?? 'application/octet-stream')
        .header('content-length', String(size))
        .header('cache-control', 'private, max-age=0, must-revalidate');
      return reply.send(createReadStream(path));
    },
  );
}
