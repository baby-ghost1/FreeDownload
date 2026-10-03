import type { Database } from '../../database/client.js';
import { auditLogs } from '../../database/schema/index.js';
import { logger } from '../../logging/logger.js';

export interface AuditEntry {
  adminId: string;
  /** Dotted verb, e.g. `admin.login`, `source.update`. */
  action: string;
  resource?: string | undefined;
  resourceId?: string | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

/**
 * Appends one immutable audit row (§75 — a trigger rejects UPDATE/DELETE).
 * An audit failure never masks a successful mutation: it degrades to a log
 * line, which the ops pipeline still ships to the same sink.
 */
export async function writeAudit(db: Database, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      adminId: entry.adminId,
      action: entry.action,
      resource: entry.resource ?? null,
      resourceId: entry.resourceId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 512) ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'failed to write audit log');
  }
}
