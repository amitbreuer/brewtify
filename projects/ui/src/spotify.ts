import { UserProfile, PlaylistsResponse, TopArtistsResponse, TracksResponse, Playlist } from './types';

export async function fetchProfile(token: string): Promise<UserProfile> {
  const result = await fetch('https://api.spotify.com/v1/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}

export async function fetchPlaylists(token: string): Promise<PlaylistsResponse> {
  const result = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}

export async function fetchTopArtists(token: string, limit: number = 20, offset: number = 0): Promise<TopArtistsResponse> {
  const result = await fetch(`https://api.spotify.com/v1/me/top/artists?limit=${limit}&offset=${offset}&time_range=medium_term`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}

export async function fetchArtistTopTracks(token: string, artistId: string): Promise<TracksResponse> {
  const result = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}

export async function createPlaylist(token: string, userId: string, name: string, description: string): Promise<Playlist> {
  const result = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      description,
      public: false
    })
  });

  return await result.json();
}

export async function addTracksToPlaylist(token: string, playlistId: string, trackUris: string[]): Promise<void> {
  // Spotify API allows max 100 tracks per request
  const chunks = [];
  for (let i = 0; i < trackUris.length; i += 100) {
    chunks.push(trackUris.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        uris: chunk
      })
    });
  }
}
