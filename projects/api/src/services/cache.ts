import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const CACHE_DIR = path.join(process.cwd(), '.cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number; // TTL in milliseconds, undefined means no expiration
}

export class CacheService {
  private getCacheFilePath(key: string): string {
    // Create a safe filename from the key using MD5 hash
    const hash = crypto.createHash('md5').update(key).digest('hex');
    return path.join(CACHE_DIR, `${hash}.json`);
  }

  async get<T>(key: string, ttl?: number): Promise<T | null> {
    const filePath = this.getCacheFilePath(key);

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // Check if TTL is defined and if the cache has expired
      if (ttl !== undefined) {
        const now = Date.now();
        const age = now - entry.timestamp;

        if (age > ttl) {
          // Cache expired, delete the file
          fs.unlinkSync(filePath);
          return null;
        }
      }

      return entry.data;
    } catch (error) {
      // If there's any error reading/parsing, treat as cache miss
      console.error('Cache read error:', error);
      return null;
    }
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const filePath = this.getCacheFilePath(key);

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
    } catch (error) {
      console.error('Cache write error:', error);
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getCacheFilePath(key);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      const files = fs.readdirSync(CACHE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      }
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }
}

export const cacheService = new CacheService();
