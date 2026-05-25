import { env } from '../utils/env';
import { SpotifyTokens, UserProfile, Playlist, Artist, Track, Album } from '../types/spotify';
import { redisCacheService, TTL } from './redis-cache';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS_BASE = 'https://accounts.spotify.com';

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

    // Step 2: Fetch tracks for all albums in parallel (30 tracks per album)
    const albumTracksPromises = albumsResponse.items.map(async (album) => {
      const tracksResponse = await this.getAlbumTracks(accessToken, album.id, 30, 0);
      // Attach album release_date to each track
      return tracksResponse.items.map((track) => ({
        ...track,
        album: { ...track.album, release_date: album.release_date },
      }));
    });

    const results = await Promise.allSettled(albumTracksPromises);

    // Step 3: Collect all tracks, deduplicate, and filter to only include
    // tracks where this artist is credited
    const allTracks: Track[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const track of result.value) {
          if (!seenTrackIds.has(track.id)) {
            const hasArtist = track.artists?.some((a: any) => a.id === artistId);
            if (hasArtist) {
              seenTrackIds.add(track.id);
              allTracks.push(track);
            }
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
}


export const spotifyService = new SpotifyService();
