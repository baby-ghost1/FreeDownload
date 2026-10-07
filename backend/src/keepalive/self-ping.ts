import { logger } from '../logging/logger.js';

export interface SelfPingOptions {
  /** Full URL of the liveness probe, e.g. `https://app.onrender.com/health`. */
  url: string;
  /** Steady-state gap between pings. Jitter is added on top. */
  intervalMs: number;
}

export interface SelfPingHandle {
  stop: () => void;
}

/**
 * Resolve the probe URL: explicit `SELF_PING_URL` wins, otherwise Render's
 * injected external URL with `/health` appended.
 */
export function resolveSelfPingUrl(
  explicitUrl: string | undefined,
  renderUrl: string | undefined,
): string | null {
  if (explicitUrl && explicitUrl.trim().length > 0) return explicitUrl.trim();
  if (renderUrl && renderUrl.trim().length > 0) {
    return `${renderUrl.trim().replace(/\/+$/, '')}/health`;
  }
  return null;
}

/**
 * Keep-alive against idle spin-down (Render free tier sleeps after 15 quiet
 * minutes): GETs the liveness probe on an interval. A ping is plain inbound
 * traffic, exactly what resets the idle timer.
 *
 * Honest limits: this PREVENTS sleep while the process runs - it cannot wake
 * a service that already spun down (first visit after that still cold-starts,
 * ~1 min on Render). Never throws; a failed ping only logs.
 */
export function startSelfPing({ url, intervalMs }: SelfPingOptions): SelfPingHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const ping = async (): Promise<void> => {
    if (stopped) return;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      // Drain the body so sockets are released back to the pool.
      await res.arrayBuffer().catch(() => undefined);
      logger.debug({ status: res.status }, 'self-ping ok');
    } catch (err) {
      logger.warn({ err }, 'self-ping failed; retrying on schedule');
    } finally {
      if (!stopped) schedule();
    }
  };

  const schedule = (): void => {
    // ±60s jitter so deploys do not beat in lockstep.
    const jitter = (Math.random() - 0.5) * 120_000;
    const delay = Math.max(5_000, intervalMs + jitter);
    timer = setTimeout(() => void ping(), delay);
    // Never hold the event loop (or a shutdown) hostage for a timer.
    timer.unref?.();
  };

  // First ping goes out on boot to prove the wiring in the logs.
  void ping();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
