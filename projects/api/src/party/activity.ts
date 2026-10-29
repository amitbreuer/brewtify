import { Redis } from '@upstash/redis';
import { createLogger } from '../utils/logger';

const log = createLogger('party-activity');

// Neon's free plan only scales compute to zero after five idle minutes and caps
// monthly compute hours, so per-minute maintenance must not query Postgres while
// Party is idle. Party requests mark activity; maintenance checks the marker first.
export const ACTIVE_KEY = 'party:maintenance:active';
export const SWEPT_KEY = 'party:maintenance:swept';
// Rooms and their bound host sessions are the longest-lived Party rows (12 hours).
export const ACTIVE_WINDOW_SECONDS = 13 * 60 * 60;
export const SWEEP_INTERVAL_SECONDS = 24 * 60 * 60;
export const MARK_INTERVAL_MS = 60_000;

export interface ActivityStore {
  mget(...keys: string[]): Promise<unknown[]>;
  set(key: string, value: string, options: { ex: number }): Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PartyActivity {
  private lastMark = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly store: ActivityStore | undefined,
    private readonly now: () => number = Date.now
  ) {}

  async mark(): Promise<void> {
    if (!this.store) return;
    const now = this.now();
    if (now - this.lastMark < MARK_INTERVAL_MS) return;
    try {
      await this.store.set(ACTIVE_KEY, String(now), { ex: ACTIVE_WINDOW_SECONDS });
      this.lastMark = now;
    } catch (error) {
      log.warn('Party activity mark failed', { error: errorMessage(error) });
    }
  }

  // Unknown state (no store or a store failure) always runs maintenance.
  async maintenanceDue(): Promise<boolean> {
    if (!this.store) return true;
    try {
      const [active, swept] = await this.store.mget(ACTIVE_KEY, SWEPT_KEY);
      return active != null || swept == null;
    } catch (error) {
      log.warn('Party activity check failed; running maintenance', {
        error: errorMessage(error),
      });
      return true;
    }
  }

  async recordMaintenance(): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.set(SWEPT_KEY, String(this.now()), {
        ex: SWEEP_INTERVAL_SECONDS,
      });
    } catch (error) {
      log.warn('Party maintenance record failed', { error: errorMessage(error) });
    }
  }
}

function upstashStore(): ActivityStore | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return undefined;
  const redis = new Redis({ url, token });
  return {
    mget: (...keys) => redis.mget<unknown[]>(...keys),
    set: (key, value, options) => redis.set(key, value, options),
  };
}

let shared: PartyActivity | undefined;
export function partyActivity(): PartyActivity {
  return (shared ??= new PartyActivity(upstashStore()));
}
