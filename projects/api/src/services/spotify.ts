import { env } from '../utils/env';
import { SpotifyTokens, UserProfile, Playlist, Artist, Track, Album } from '../types/spotify';
import { redisCacheService, TTL } from './redis-cache';
import { createLogger } from '../utils/logger';
import PQueue from 'p-queue';

const log = createLogger('spotify-service');

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS_BASE = 'https://accounts.spotify.com';

const MAX_RETRIES = 3;
// Concurrency-limited queue for Spotify API calls
const spotifyQueue = new PQueue({ concurrency: 5, interval: 1000, intervalCap: 10 });

export class SpotifyService {
  private clientId!: string;
  private clientSecret!: string;
  private redirectUri!: string;
  private initialized = false;

  private initialize() {
    if (!this.initialized) {
      this.clientId = env('SPOTIFY_CLIENT_ID');
      this.clientSecret = env('SPOTIFY_CLIENT_SECRET');
      this.redirectUri = env('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:5173/callback');
      this.initialized = true;
    }
  }

  getAuthUrl(state: string): string {
    this.initialize();
    const scopes = [
      'user-read-private',
      'user-read-email',
      'playlist-read-private',
      'playlist-modify-private',
      'playlist-modify-public',
      'user-follow-read',
      'user-follow-modify',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: scopes,
      state,
    });

    return `${SPOTIFY_ACCOUNTS_BASE}/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<SpotifyTokens> {
    this.initialize();
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });

    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to exchange code: ${response.status} - ${body}`);
    }

    return await response.json();
  }


  async refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
    this.initialize();
    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    // Create Basic Authorization header with client credentials
    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to refresh access token: ${response.status} - ${errorBody}`);
    }

    return await response.json();
  }

  // API Methods
  private async makeRequest<T>(endpoint: string, accessToken: string, options: RequestInit = {}, retryCount = 0): Promise<T> {
    return spotifyQueue.add(async () => {
      const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      // Retry with backoff on rate limit (429)
      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10);
        log.warn(`Rate limited, retrying after ${retryAfter}s`, { endpoint, attempt: retryCount + 1, maxRetries: MAX_RETRIES });
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return this.makeRequest<T>(endpoint, accessToken, options, retryCount + 1);
      }

      if (!response.ok) {
        throw new Error(`Spotify API error: ${response.status} ${response.statusText} (${endpoint})`);
      }

      return await response.json() as T;
    }) as T;
  }

  async getProfile(accessToken: string): Promise<UserProfile> {
    return this.makeRequest<UserProfile>('/me', accessToken);
  }

  async getPlaylists(accessToken: string, limit: number = 50): Promise<{ items: Playlist[]; total: number }> {
    return this.makeRequest<{ items: Playlist[]; total: number }>(
      `/me/playlists?limit=${limit}`,
      accessToken
    );
  }

  async getPlaylist(accessToken: string, playlistId: string): Promise<Playlist> {
    return this.makeRequest<Playlist>(
      `/playlists/${playlistId}`,
      accessToken
    );
  }

  async getFollowedArtists(
    accessToken: string,
    limit: number = 50,
    after?: string
  ): Promise<{ items: Artist[]; next: string | null; total: number }> {
    const tokenHash = accessToken.slice(-16);
    const cacheKey = `followed-artists:${tokenHash}:${limit}:${after || ''}`;
    const cached = await redisCacheService.get<{ items: Artist[]; next: string | null; total: number }>(cacheKey);

    if (cached) {
      return cached;
    }

    const params = new URLSearchParams({
      type: 'artist',
      limit: limit.toString(),
      ...(after ? { after } : {}),
    });

    const response = await this.makeRequest<any>(
      `/me/following?${params}`,
      accessToken
    );

    const { artists } = response;
    const { items, cursors, total = 0 } = artists || {};

    const result = {
      items: items || [],
      next: cursors?.after || null,
      total,
    };

    await redisCacheService.set(cacheKey, result, TTL.FOLLOWED_ARTISTS);

    return result;
  }

  async getArtists(accessToken: string, ids: string[]): Promise<Artist[]> {
    // Spotify allows max 50 IDs per request
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) {
      chunks.push(ids.slice(i, i + 50));
    }
    const results: Artist[] = [];
    for (const chunk of chunks) {
      const data = await this.makeRequest<{ artists: Artist[] }>(
        `/artists?ids=${chunk.join(',')}`,
        accessToken
      );
      results.push(...data.artists);
    }
    return results;
  }

  async getArtistAlbums(
    accessToken: string,
    artistId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ items: Album[]; total: number; limit: number; offset: number; next: string | null }> {
    const cacheKey = `artist-albums:${artistId}:${limit}:${offset}`;
    const cached = await redisCacheService.get<{ items: Album[]; total: number; limit: number; offset: number; next: string | null }>(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await this.makeRequest<any>(
      `/artists/${artistId}/albums?limit=${limit}&offset=${offset}&include_groups=album,single,appears_on`,
      accessToken
    );

    await redisCacheService.set(cacheKey, result, TTL.ARTIST_ALBUMS);

    return result;
  }

  async getAlbumTracks(
    accessToken: string,
    albumId: string,
    limit: number = 30,
    offset: number = 0
  ): Promise<{ items: Track[]; total: number; limit: number; offset: number; next: string | null }> {
    const cacheKey = `album-tracks:${albumId}:${limit}:${offset}`;
    const cached = await redisCacheService.get<{ items: Track[]; total: number; limit: number; offset: number; next: string | null }>(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await this.makeRequest<any>(
      `/albums/${albumId}/tracks?limit=${limit}&offset=${offset}`,
      accessToken
    );

    await redisCacheService.set(cacheKey, result, TTL.ALBUM_TRACKS);

    return result;
  }

  async getAllArtistTracks(accessToken: string, artistId: string): Promise<Track[]> {
    const seenTrackIds = new Set<string>();

    // Step 1: Fetch 20 albums for the artist
    const albumsResponse = await this.getArtistAlbums(accessToken, artistId, 20, 0);
    const albumIds = albumsResponse.items.map(a => a.id);

    // Step 2: Use batch album endpoint (up to 20 per request, includes tracks)
    const allTracks: Track[] = [];
    const albumChunks: string[][] = [];
    for (let i = 0; i < albumIds.length; i += 20) {
      albumChunks.push(albumIds.slice(i, i + 20));
    }

    for (const chunk of albumChunks) {
      const albums = await this.getAlbumsBatch(accessToken, chunk);
      for (const album of albums) {
        const tracks = album.tracks?.items || [];
        for (const track of tracks) {
          if (!seenTrackIds.has(track.id)) {
            const hasArtist = track.artists?.some((a: any) => a.id === artistId);
            if (hasArtist) {
              seenTrackIds.add(track.id);
              allTracks.push({
                ...track,
                album: { ...track.album, release_date: album.release_date },
              });
            }
          }
        }
      }
    }

    return allTracks;
  }

  /**
   * Batch fetch up to 20 albums in a single request (includes first 50 tracks per album).
   * Uses cache for each album individually to maximize cache hits.
   */
  private async getAlbumsBatch(accessToken: string, albumIds: string[]): Promise<any[]> {
    const results: any[] = [];
    const uncachedIds: string[] = [];

    // Check cache first for each album
    for (const id of albumIds) {
      const cached = await redisCacheService.get<any>(`album-full:${id}`);
      if (cached) {
        results.push(cached);
      } else {
        uncachedIds.push(id);
      }
    }

    // Fetch uncached albums in one batch call
    if (uncachedIds.length > 0) {
      const data = await this.makeRequest<{ albums: any[] }>(
        `/albums?ids=${uncachedIds.join(',')}`,
        accessToken
      );
      for (const album of data.albums) {
        if (album) {
          await redisCacheService.set(`album-full:${album.id}`, album, TTL.ALBUM_TRACKS);
          results.push(album);
        }
      }
    }

    return results;
  }

  async createPlaylist(
    accessToken: string,
    userId: string,
    name: string,
    description: string
  ): Promise<Playlist> {
    return this.makeRequest<Playlist>(
      `/users/${userId}/playlists`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          public: false,
        }),
      }
    );
  }

  async addTracksToPlaylist(
    accessToken: string,
    playlistId: string,
    trackUris: string[]
  ): Promise<void> {
    log.debug('addTracksToPlaylist called', { playlistId, trackCount: trackUris.length });

    // Spotify API allows max 100 tracks per request
    const chunks = [];
    for (let i = 0; i < trackUris.length; i += 100) {
      chunks.push(trackUris.slice(i, i + 100));
    }

    for (const chunk of chunks) {
      await this.makeRequest<any>(
        `/playlists/${playlistId}/tracks`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ uris: chunk }),
        }
      );
    }

    log.info('Tracks added to playlist', { playlistId, totalTracks: trackUris.length, chunks: chunks.length });
  }

  async replacePlaylistTracks(
    accessToken: string,
    playlistId: string,
    trackUris: string[]
  ): Promise<void> {
    // First request replaces (max 100 tracks)
    const firstChunk = trackUris.slice(0, 100);
    await this.makeRequest<any>(
      `/playlists/${playlistId}/tracks`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ uris: firstChunk }),
      }
    );

    // Subsequent requests append remaining tracks
    if (trackUris.length > 100) {
      const remainingUris = trackUris.slice(100);
      await this.addTracksToPlaylist(accessToken, playlistId, remainingUris);
    }
  }

  async unfollowPlaylist(accessToken: string, playlistId: string): Promise<void> {
    const response = await fetch(`${SPOTIFY_API_BASE}/playlists/${playlistId}/followers`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.statusText}`);
    }
  }

  async updatePlaylistDetails(
    accessToken: string,
    playlistId: string,
    details: { name?: string; description?: string; public?: boolean }
  ): Promise<void> {
    const response = await fetch(`${SPOTIFY_API_BASE}/playlists/${playlistId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(details),
    });

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.statusText}`);
    }

    // Spotify's update playlist endpoint returns empty body, no need to parse JSON
  }

  async searchArtists(
    accessToken: string,
    query: string,
    limit: number = 20
  ): Promise<{ items: Artist[]; total: number }> {
    const params = new URLSearchParams({
      q: query,
      type: 'artist',
      limit: limit.toString(),
    });

    const data = await this.makeRequest<any>(
      `/search?${params}`,
      accessToken
    );

    return {
      items: data.artists?.items || [],
      total: data.artists?.total || 0,
    };
  }



  async followArtists(accessToken: string, ids: string[]): Promise<void> {
    const response = await fetch(
      `${SPOTIFY_API_BASE}/me/following?type=artist&ids=${ids.join(',')}`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
    }
  }

  async unfollowArtists(accessToken: string, ids: string[]): Promise<void> {
    const response = await fetch(
      `${SPOTIFY_API_BASE}/me/following?type=artist&ids=${ids.join(',')}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
    }
  }

  async checkFollowingArtists(accessToken: string, ids: string[]): Promise<boolean[]> {
    const data = await this.makeRequest<boolean[]>(
      `/me/following/contains?type=artist&ids=${ids.join(',')}`,
      accessToken
    );
    return data;
  }
}


export const spotifyService = new SpotifyService();
