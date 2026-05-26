import { Redis } from '@upstash/redis';
import { env } from '../utils/env';
import { createLogger } from '../utils/logger';

const log = createLogger('redis-cache');

// TTL constants (in seconds for Redis)
export const TTL = {
  ARTIST_ALBUMS: 60 * 60 * 24 * 60, // 2 months
  ALBUM_TRACKS: 60 * 60 * 24 * 180, // 6 months (effectively permanent)
  FOLLOWED_ARTISTS: 60 * 5,         // 5 minutes
  PLAYLIST_META: 60 * 60,            // 1 hour
  PENDING_AUTH: 60 * 10,             // 10 minutes
} as const;

let redis: Redis | null = null;
let consecutiveErrors = 0;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: env('UPSTASH_REDIS_REST_URL'),
      token: env('UPSTASH_REDIS_REST_TOKEN'),
    });
  }
  return redis;
}

function handleRedisError(operation: string, key: string, error: unknown): void {
  consecutiveErrors++;
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (consecutiveErrors >= 3) {
    log.error(`Redis ${operation} failed (${consecutiveErrors} consecutive errors)`, { key, error: errorMessage });
  } else {
    log.warn(`Redis ${operation} failed`, { key, error: errorMessage });
  }
}

function resetErrorCounter(): void {
  if (consecutiveErrors > 0) {
    consecutiveErrors = 0;
  }
}

export class RedisCacheService {
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await getRedis().get<T>(key);
      resetErrorCounter();
      return data ?? null;
    } catch (error) {
      handleRedisError('GET', key, error);
      return null;
    }
  }

  async set<T>(key: string, data: T, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await getRedis().set(key, data, { ex: ttlSeconds });
      } else {
        await getRedis().set(key, data);
      }
      resetErrorCounter();
    } catch (error) {
      handleRedisError('SET', key, error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await getRedis().del(key);
      resetErrorCounter();
    } catch (error) {
      handleRedisError('DEL', key, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await getRedis().exists(key);
      resetErrorCounter();
      return result === 1;
    } catch (error) {
      handleRedisError('EXISTS', key, error);
      return false;
    }
  }
}

export const redisCacheService = new RedisCacheService();
