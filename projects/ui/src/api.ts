import {
  UserProfile,
  PlaylistsResponse,
  Artist,
  Track,
  Playlist,
} from "./types";

const API_BASE = 'http://127.0.0.1:3000';

async function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include', // Important for cookies/sessions
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }

  return await response.json();
}

// Auth
export async function storeSession(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
  await fetchAPI('/auth/session', {
    method: 'POST',
    body: JSON.stringify({ accessToken, refreshToken, expiresIn }),
  });
}

export async function checkAuthStatus(): Promise<{ authenticated: boolean }> {
  return fetchAPI<{ authenticated: boolean }>('/auth/status');
}

export async function logout(): Promise<void> {
  await fetchAPI('/auth/logout', { method: 'POST' });
}

// Spotify API
export async function fetchProfile(): Promise<UserProfile> {
  return fetchAPI<UserProfile>('/api/profile');
}

export async function fetchPlaylists(): Promise<PlaylistsResponse> {
  return fetchAPI<PlaylistsResponse>('/api/playlists?limit=50');
}

export async function fetchFollowedArtists(
  limit: number = 50,
  after?: string
): Promise<{ items: Artist[]; next: string | null; total: number }> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    ...(after ? { after } : {}),
  });
  return fetchAPI<{ items: Artist[]; next: string | null; total: number }>(
    `/api/artists/followed?${params}`
  );
}

export async function fetchAllArtistTracks(artistId: string): Promise<Track[]> {
  return fetchAPI<Track[]>(`/api/artists/${artistId}/tracks`);
}

export async function createPlaylist(
  userId: string,
  name: string,
  description: string
): Promise<Playlist> {
  return fetchAPI<Playlist>('/api/playlists', {
    method: 'POST',
    body: JSON.stringify({ userId, name, description }),
  });
}

export async function addTracksToPlaylist(
  playlistId: string,
  trackUris: string[]
): Promise<void> {
  await fetchAPI(`/api/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ trackUris }),
  });
}

export async function updatePlaylist(
  playlistId: string
): Promise<{ success: boolean; trackCount: number; artistCount: number }> {
  return fetchAPI<{ success: boolean; trackCount: number; artistCount: number }>(
    `/api/playlists/${playlistId}/update`,
    {
      method: 'POST',
    }
  );
}
