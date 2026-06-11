import type { UserProfile, Playlist, Artist, Track } from './types';

const API_BASE = import.meta.env.VITE_API_BASE || '';

function getTelegramUserId(): string | null {
  try {
    const webapp = (window as any).Telegram?.WebApp;
    const id = webapp?.initDataUnsafe?.user?.id?.toString();
    if (id) return id;
  } catch {}

  // Dev fallback: set VITE_TELEGRAM_USER_ID in .env.local for browser testing
  return import.meta.env.VITE_TELEGRAM_USER_ID || null;
}

async function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const telegramUserId = getTelegramUserId();

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(telegramUserId ? { 'X-Telegram-User-Id': telegramUserId } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`API error ${response.status}: ${text}`);
    (error as any).status = response.status;
    throw error;
  }

  return await response.json();
}

export async function fetchProfile(): Promise<UserProfile> {
  return fetchAPI<UserProfile>('/api/profile');
}

export async function logout(): Promise<void> {
  await fetchAPI('/logout', { method: 'POST' });
}

export async function fetchPlaylists(): Promise<{ items: Playlist[]; total: number }> {
  return fetchAPI<{ items: Playlist[]; total: number }>('/api/playlists?limit=50');
}

export async function fetchFollowedArtists(
  limit = 50,
  after?: string
): Promise<{ items: Artist[]; next: string | null; total: number }> {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (after) params.set('after', after);
  return fetchAPI(`/api/artists/followed?${params}`);
}

export async function fetchAllArtistTracks(artistId: string): Promise<Track[]> {
  return fetchAPI<Track[]>(`/api/artists/${artistId}/tracks`);
}

export interface CreatePlaylistParams {
  userId: string;
  name: string;
  description?: string;
  artistIds: string[];
  trackCount: number;
  weights?: Record<string, number>;
  eraPreference?: number;
  eraPreferences?: Record<string, number>;
  schedule?: string | null;
}

export async function createPlaylist(params: CreatePlaylistParams): Promise<Playlist> {
  return fetchAPI<Playlist>('/api/playlists', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function addTracksToPlaylist(playlistId: string, trackUris: string[]): Promise<void> {
  await fetchAPI(`/api/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ trackUris }),
  });
}

export async function updatePlaylist(
  playlistId: string
): Promise<{ success: boolean; trackCount: number; artistCount: number }> {
  return fetchAPI(`/api/playlists/${playlistId}/update`, { method: 'POST' });
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  await fetchAPI(`/api/playlists/${playlistId}`, { method: 'DELETE' });
}

export async function renamePlaylist(playlistId: string, name: string): Promise<void> {
  await fetchAPI(`/api/playlists/${playlistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export interface PlaylistSettings {
  managed: boolean;
  artistIds?: string[];
  trackCount?: number;
  weights?: Record<string, number> | null;
  eraPreference?: number;
  eraPreferences?: Record<string, number> | null;
  schedule?: string | null;
  status?: string;
  lastUpdatedAt?: string | null;
  nextUpdateAt?: string | null;
}

export async function fetchPlaylistSettings(playlistId: string): Promise<PlaylistSettings> {
  return fetchAPI<PlaylistSettings>(`/api/playlists/${playlistId}/settings`);
}

export async function updatePlaylistSettings(
  playlistId: string,
  settings: { artistIds?: string[]; trackCount?: number; weights?: Record<string, number> | null; eraPreference?: number; eraPreferences?: Record<string, number> | null; schedule?: string | null }
): Promise<void> {
  await fetchAPI(`/api/playlists/${playlistId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

export async function fetchPlaylist(playlistId: string): Promise<Playlist> {
  return fetchAPI<Playlist>(`/api/playlists/${playlistId}`);
}

export async function fetchArtistsByIds(ids: string[]): Promise<Artist[]> {
  return fetchAPI<Artist[]>(`/api/artists?ids=${ids.join(',')}`);
}

export async function searchArtists(
  query: string,
  limit = 20
): Promise<{ items: Artist[]; total: number }> {
  const params = new URLSearchParams({ q: query, limit: limit.toString() });
  return fetchAPI<{ items: Artist[]; total: number }>(`/api/artists/search?${params}`);
}

export async function fetchSuggestedArtists(): Promise<{ items: Artist[] }> {
  return fetchAPI<{ items: Artist[] }>('/api/artists/suggested');
}

export async function checkFollowingArtists(
  ids: string[]
): Promise<{ id: string; following: boolean }[]> {
  return fetchAPI<{ id: string; following: boolean }[]>(
    `/api/artists/following/check?ids=${ids.join(',')}`
  );
}

export async function followArtist(id: string): Promise<void> {
  await fetchAPI('/api/artists/follow', {
    method: 'PUT',
    body: JSON.stringify({ ids: [id] }),
  });
}

export async function unfollowArtist(id: string): Promise<void> {
  await fetchAPI('/api/artists/follow', {
    method: 'DELETE',
    body: JSON.stringify({ ids: [id] }),
  });
}

export async function fetchAllFollowedArtists(): Promise<Artist[]> {
  const all: Artist[] = [];
  let after: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const data = await fetchFollowedArtists(50, after);
    all.push(...data.items);
    after = data.next || undefined;
    hasMore = data.next !== null;
  }

  all.sort((a, b) => b.followers.total - a.followers.total);
  return all;
}
