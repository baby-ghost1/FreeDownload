import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { closeDatabase, getDb } from '../../src/database/client.js';
import { seed } from '../../src/database/seed.js';
import { downloadJobs, systemSettings } from '../../src/database/schema/index.js';
import {
  assertQuota,
  getAnonDailyLimit,
  invalidateSettingsCache,
  resolveQuota,
} from '../../src/limits/engine.js';
import { updateSetting } from '../../src/modules/admin/service.js';
import { infraAvailable, inCi } from '../helpers/infra.js';

const infraUp = (await infraAvailable()) || inCi;

describe.runIf(infraUp)('anonymous daily limit (admin console setting)', () => {
  const actor = { anonKey: 'test-anon-key-quota' };

  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('is off by default (null) and skips the daily check', async () => {
    const db = getDb();
    await db.delete(systemSettings).where(eq(systemSettings.key, 'anon_daily_limit'));
    invalidateSettingsCache();

    await expect(getAnonDailyLimit(db)).resolves.toBeNull();
    const quota = await resolveQuota(db, actor);
    expect(quota.planCode).toBe('anonymous');
    expect(quota.jobsPerDay).toBeNull();
    await expect(assertQuota(db, quota, actor)).resolves.toBeUndefined();
  });

  it('enforces the admin-set value, then lifts it again', async () => {
    const db = getDb();
    await updateSetting(db, 'anon_daily_limit', 2, 'test-admin');
    await expect(getAnonDailyLimit(db)).resolves.toBe(2);
    await db.insert(downloadJobs).values([
      { urlHash: 'quota-h1', anonKey: actor.anonKey },
      { urlHash: 'quota-h2', anonKey: actor.anonKey },
    ]);

    const quota = await resolveQuota(db, actor);
    expect(quota.jobsPerDay).toBe(2);
    await expect(assertQuota(db, quota, actor)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });

    await db.delete(downloadJobs).where(eq(downloadJobs.anonKey, actor.anonKey));
    await updateSetting(db, 'anon_daily_limit', 0, 'test-admin');
    await expect(getAnonDailyLimit(db)).resolves.toBeNull();
  });

  it('treats 0 as unlimited', async () => {
    const db = getDb();
    await updateSetting(db, 'anon_daily_limit', 0, 'test-admin');
    const quota = await resolveQuota(db, actor);
    expect(quota.jobsPerDay).toBeNull();
    await expect(assertQuota(db, quota, actor)).resolves.toBeUndefined();
  });

  it('rejects invalid values', async () => {
    const db = getDb();
    await expect(updateSetting(db, 'anon_daily_limit', -3, 'x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(updateSetting(db, 'anon_daily_limit', 'lots', 'x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(updateSetting(db, 'anon_daily_limit', 2.5, 'x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
