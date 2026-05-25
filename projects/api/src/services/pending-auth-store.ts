import { redisCacheService, TTL } from './redis-cache';

const PREFIX = 'pending-auth:';

/**
 * Redis-backed store for pending OAuth state → telegramUserId mappings.
 * Replaces the in-memory Map with auto-expiry via Redis TTL.
 */
export const pendingAuthStore = {
  async set(state: string, telegramUserId: string): Promise<void> {
    await redisCacheService.set(`${PREFIX}${state}`, telegramUserId, TTL.PENDING_AUTH);
  },

  async get(state: string): Promise<string | null> {
    return redisCacheService.get<string>(`${PREFIX}${state}`);
  },

  async delete(state: string): Promise<void> {
    await redisCacheService.delete(`${PREFIX}${state}`);
  },
};
