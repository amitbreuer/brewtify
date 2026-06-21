import { redisCacheService, TTL } from './redis-cache';
import { createLogger } from '../utils/logger';
import { env } from '../utils/env';
import PQueue from 'p-queue';

const log = createLogger('lastfm-service');

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0';

// Last.fm allows 5 requests/second
const lastfmQueue = new PQueue({ concurrency: 3, interval: 1000, intervalCap: 5 });

export interface LastFmSimilarArtist {
  name: string;
  mbid: string;
  match: number; // 0-1 similarity score
  url: string;
}

export class LastFmService {
  private apiKey!: string;
  private initialized = false;

  private initialize() {
    if (!this.initialized) {
      this.apiKey = env('LASTFM_API_KEY');
      this.initialized = true;
    }
  }

  async getSimilarArtists(artistName: string, limit = 20): Promise<LastFmSimilarArtist[]> {
    this.initialize();

    const cacheKey = `lastfm:similar:${artistName.toLowerCase()}`;
    const cached = await redisCacheService.get<LastFmSimilarArtist[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await lastfmQueue.add(async () => {
        const params = new URLSearchParams({
          method: 'artist.getsimilar',
          artist: artistName,
          api_key: this.apiKey,
          format: 'json',
          limit: limit.toString(),
          autocorrect: '1',
        });

        const response = await fetch(`${LASTFM_API_BASE}?${params}`);

        if (!response.ok) {
          throw new Error(`Last.fm API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(`Last.fm API error ${data.error}: ${data.message}`);
        }

        const artists: LastFmSimilarArtist[] = (data.similarartists?.artist || []).map(
          (a: any) => ({
            name: a.name,
            mbid: a.mbid || '',
            match: parseFloat(a.match) || 0,
            url: a.url || '',
          }),
        );

        return artists;
      });

      const artists = result as LastFmSimilarArtist[];
      await redisCacheService.set(cacheKey, artists, TTL.LASTFM_SIMILAR);

      return artists;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.warn(`Failed to get similar artists for "${artistName}"`, { error: message });
      return [];
    }
  }
}

export const lastFmService = new LastFmService();
