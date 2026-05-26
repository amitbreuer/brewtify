import { Redis } from '@upstash/redis';
import { env } from '../utils/env';

// TTL constants (in seconds for Redis)
export const TTL = {
  ARTIST_ALBUMS: 60 * 60 * 24 * 60, // 2 months
  ALBUM_TRACKS: 60 * 60 * 24 * 180, // 6 months (effectively permanent)
  FOLLOWED_ARTISTS: 60 * 5,         // 5 minutes
  PLAYLIST_META: 60 * 60,            // 1 hour
  PENDING_AUTH: 60 * 10,             // 10 minutes
} as const;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: env('UPSTASH_REDIS_REST_URL'),
      token: env('UPSTASH_REDIS_REST_TOKEN'),
    });
  }
  return redis;
}

export class RedisCacheService {
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await getRedis().get<T>(key);
      return data ?? null;
    } catch (error) {
      console.error('Redis cache read error:', error);
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
    } catch (error) {
      console.error('Redis cache write error:', error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await getRedis().del(key);
    } catch (error) {
      console.error('Redis cache delete error:', error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await getRedis().exists(key);
      return result === 1;
    } catch (error) {
      console.error('Redis exists error:', error);
      return false;
    }
  }
}

export const redisCacheService = new RedisCacheService();
