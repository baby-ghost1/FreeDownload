export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface HealthCheck {
  name: string;
  /** Coarse status only — never expose hosts, credentials or versions (§43). */
  run(): Promise<CheckStatus> | CheckStatus;
}

/**
 * Readiness checks are registered by each infrastructure module as it lands
 * (Postgres in Phase 2, Redis/queue in Phase 3, R2 in Phase 4).
 */
class ReadinessRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  has(name: string): boolean {
    return this.checks.has(name);
  }

  async run(): Promise<{ ready: boolean; checks: Record<string, CheckStatus> }> {
    const results: Record<string, CheckStatus> = {};
    let ready = true;

    for (const [name, check] of this.checks) {
      try {
        const status = await check.run();
        results[name] = status;
        if (status === 'fail') ready = false;
      } catch {
        results[name] = 'fail';
        ready = false;
      }
    }

    return { ready, checks: results };
  }
}

export const readinessRegistry = new ReadinessRegistry();
