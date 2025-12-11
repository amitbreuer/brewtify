import { env } from '../utils/env';
import { SpotifyTokens, UserProfile, Playlist, Artist, Track, Album } from '../types/spotify';
import { cacheService } from './cache';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS_BASE = 'https://accounts.spotify.com';

// Cache TTLs
const TWO_MONTHS_MS = 60 * 24 * 60 * 60 * 1000; // 2 months in milliseconds

export class SpotifyService {
  private clientId!: string;
  private clientSecret!: string;
  private redirectUri!: string;
  private initialized = false;

  private initialize() {
    if (!this.initialized) {
      this.clientId = env('SPOTIFY_CLIENT_ID');
      this.clientSecret = env('SPOTIFY_CLIENT_SECRET');
      this.redirectUri = 'http://localhost:3000/auth/callback';
      this.initialized = true;
    }
  }

  // OAuth Methods
  async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<SpotifyTokens> {
    this.initialize();
    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', this.redirectUri);
    params.append('code_verifier', codeVerifier);

    const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!response.ok) {
      throw new Error('Failed to exchange code for tokens');
    }

    return await response.json();
  }

  async refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
    this.initialize();
    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!response.ok) {
      throw new Error('Failed to refresh access token');
    }

    return await response.json();
  }

  // API Methods
  private async makeRequest<T>(endpoint: string, accessToken: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.statusText}`);
    }

    return await response.json();
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

    return {
      items: items || [],
      next: cursors?.after || null,
      total,
    };
  }

  async getArtistAlbums(
    accessToken: string,
    artistId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ items: Album[]; total: number; limit: number; offset: number; next: string | null }> {
    // Check cache first (2 month TTL)
    const cacheKey = `artist-albums:${artistId}:${limit}:${offset}`;
    const cached = await cacheService.get<{ items: Album[]; total: number; limit: number; offset: number; next: string | null }>(
      cacheKey,
      TWO_MONTHS_MS
    );

    if (cached) {
      return cached;
    }

    // Fetch from API
    const result = await this.makeRequest<any>(
      `/artists/${artistId}/albums?limit=${limit}&offset=${offset}`,
      accessToken
    );

    // Store in cache
    await cacheService.set(cacheKey, result, TWO_MONTHS_MS);

    return result;
  }

  async getAlbumTracks(
    accessToken: string,
    albumId: string,
    limit: number = 30,
    offset: number = 0
  ): Promise<{ items: Track[]; total: number; limit: number; offset: number; next: string | null }> {
    // Check cache first (no TTL - permanent cache)
    const cacheKey = `album-tracks:${albumId}:${limit}:${offset}`;
    const cached = await cacheService.get<{ items: Track[]; total: number; limit: number; offset: number; next: string | null }>(cacheKey);

    if (cached) {
      return cached;
    }

    // Fetch from API
    const result = await this.makeRequest<any>(
      `/albums/${albumId}/tracks?limit=${limit}&offset=${offset}`,
      accessToken
    );

    // Store in cache (no TTL)
    await cacheService.set(cacheKey, result);

    return result;
  }

  async getAllArtistTracks(accessToken: string, artistId: string): Promise<Track[]> {
    const seenTrackIds = new Set<string>();

    // Step 1: Fetch 20 albums for the artist
    const albumsResponse = await this.getArtistAlbums(accessToken, artistId, 20, 0);

    // Step 2: Fetch tracks for all albums in parallel (30 tracks per album)
    const albumTracksPromises = albumsResponse.items.map(async (album) => {
      const tracksResponse = await this.getAlbumTracks(accessToken, album.id, 30, 0);
      return tracksResponse.items;
    });

    const results = await Promise.allSettled(albumTracksPromises);

    // Step 3: Collect all tracks and deduplicate
    const allTracks: Track[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const track of result.value) {
          if (!seenTrackIds.has(track.id)) {
            seenTrackIds.add(track.id);
            allTracks.push(track);
          }
        }
      }
    }

    return allTracks;
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
    console.log(`[SpotifyService] addTracksToPlaylist called with ${trackUris.length} tracks`);

    // Spotify API allows max 100 tracks per request
    const chunks = [];
    for (let i = 0; i < trackUris.length; i += 100) {
      chunks.push(trackUris.slice(i, i + 100));
    }

    console.log(`[SpotifyService] Split into ${chunks.length} chunks`);

    for (const chunk of chunks) {
      console.log(`[SpotifyService] Adding chunk of ${chunk.length} tracks to playlist ${playlistId}`);
      await this.makeRequest<any>(
        `/playlists/${playlistId}/tracks`,
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ uris: chunk }),
        }
      );
      console.log(`[SpotifyService] Chunk added successfully`);
    }

    console.log(`[SpotifyService] All tracks added successfully`);
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
}


export const spotifyService = new SpotifyService();
