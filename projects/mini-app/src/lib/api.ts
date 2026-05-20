import type { UserProfile, Playlist, Artist, Track } from './types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:5173';

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
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return await response.json();
}

export async function fetchProfile(): Promise<UserProfile> {
  return fetchAPI<UserProfile>('/api/profile');
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

export async function updatePlaylistDescription(playlistId: string, description: string): Promise<void> {
  await fetchAPI(`/api/playlists/${playlistId}/description`, {
    method: 'PATCH',
    body: JSON.stringify({ description }),
  });
}

export async function fetchPlaylist(playlistId: string): Promise<Playlist> {
  return fetchAPI<Playlist>(`/api/playlists/${playlistId}`);
}

export async function fetchArtistsByIds(ids: string[]): Promise<Artist[]> {
  return fetchAPI<Artist[]>(`/api/artists?ids=${ids.join(',')}`);
}
