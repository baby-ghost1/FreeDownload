import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/server/config.js';

/**
 * Production hardening matrix (contract §56): the process must refuse to
 * boot on missing secrets, dev-default infrastructure, SSRF escape hatches
 * and half-configured payment providers — never degrade silently.
 */
const PROD_OK: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  SESSION_SECRET: 's'.repeat(64),
  COOKIE_SECRET: 'c'.repeat(64),
  DATABASE_URL: 'postgres://user:pass@db.internal:5432/freedownload',
  REDIS_URL: 'redis://cache.internal:6379',
  WORKER_RUNNER: 'pipeline',
};

describe('loadEnv: schema validation', () => {
  it('accepts a fully specified production environment', () => {
    const env = loadEnv(PROD_OK);
    expect(env.NODE_ENV).toBe('production');
    expect(env.PAYMENT_PROVIDER).toBe('none');
  });

  it('rejects out-of-range and unknown values before any hardening check', () => {
    expect(() => loadEnv({ ...PROD_OK, SESSION_TTL_MIN: '4' })).toThrow(/SESSION_TTL_MIN/);
    expect(() => loadEnv({ ...PROD_OK, PAYMENT_PROVIDER: 'paypal' })).toThrow(/PAYMENT_PROVIDER/);
    expect(() => loadEnv({ ...PROD_OK, STORAGE_DRIVER: 's3' })).toThrow(/STORAGE_DRIVER/);
    expect(() => loadEnv({ ...PROD_OK, ARGON2_MEMORY_KIB: '1024' })).toThrow(/ARGON2_MEMORY_KIB/);
  });

  it('coerces numeric and boolean strings', () => {
    const env = loadEnv({ PORT: '8080', TRUST_PROXY: 'true', SSRF_ALLOW_PRIVATE: '0' });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(true);
    expect(env.SSRF_ALLOW_PRIVATE).toBe(false);
  });
});

describe('loadEnv: production hardening', () => {
  it('requires both session and cookie secrets', () => {
    const { SESSION_SECRET: _s, COOKIE_SECRET: _c, ...rest } = PROD_OK;
    const message = () => loadEnv(rest);
    expect(message).toThrow(/SESSION_SECRET/);
    expect(message).toThrow(/COOKIE_SECRET/);
  });

  it('rejects a too-short cookie secret even when present', () => {
    expect(() => loadEnv({ ...PROD_OK, COOKIE_SECRET: 'short' })).toThrow(/COOKIE_SECRET/);
  });

  it('forbids the dev-default database and redis URLs', () => {
    expect(() =>
      loadEnv({
        ...PROD_OK,
        DATABASE_URL: 'postgres://freedownload:freedownload_dev@localhost:5432/freedownload',
      }),
    ).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...PROD_OK, REDIS_URL: 'redis://localhost:6379' })).toThrow(/REDIS_URL/);
  });

  it('never allows the SSRF private-network escape hatch', () => {
    expect(() => loadEnv({ ...PROD_OK, SSRF_ALLOW_PRIVATE: 'true' })).toThrow(/SSRF_ALLOW_PRIVATE/);
  });

  it('requires the real pipeline runner', () => {
    expect(() => loadEnv({ ...PROD_OK, WORKER_RUNNER: 'placeholder' })).toThrow(/WORKER_RUNNER/);
  });

  it('requires both Stripe secrets when the provider is stripe', () => {
    const message = () => loadEnv({ ...PROD_OK, PAYMENT_PROVIDER: 'stripe' });
    expect(message).toThrow(/PAYMENT_PROVIDER_SECRET/);
    expect(message).toThrow(/PAYMENT_WEBHOOK_SECRET/);
  });

  it('accepts stripe when both secrets are present', () => {
    const env = loadEnv({
      ...PROD_OK,
      PAYMENT_PROVIDER: 'stripe',
      PAYMENT_PROVIDER_SECRET: 'sk_live_x'.repeat(8),
      PAYMENT_WEBHOOK_SECRET: 'whsec_x'.repeat(8),
    });
    expect(env.PAYMENT_PROVIDER).toBe('stripe');
  });

  it('requires the full R2 credential set when storage is r2', () => {
    expect(() => loadEnv({ ...PROD_OK, STORAGE_DRIVER: 'r2' })).toThrow(/R2_ACCOUNT_ID/);

    const env = loadEnv({
      ...PROD_OK,
      STORAGE_DRIVER: 'r2',
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'media',
    });
    expect(env.STORAGE_DRIVER).toBe('r2');
  });

  it('skips every hardening rule outside production', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SSRF_ALLOW_PRIVATE: 'true',
      WORKER_RUNNER: 'placeholder',
    });
    expect(env.NODE_ENV).toBe('test');
    expect(env.SSRF_ALLOW_PRIVATE).toBe(true);
  });
});
