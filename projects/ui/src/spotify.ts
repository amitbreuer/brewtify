import {
  UserProfile,
  PlaylistsResponse,
  TopArtistsResponse,
  TracksResponse,
  Playlist,
  Artist,
  AlbumsResponse,
  AlbumTracksResponse,
  Track,
} from "./types";

export async function fetchProfile(token: string): Promise<UserProfile> {
  const result = await fetch("https://api.spotify.com/v1/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}

export async function fetchPlaylists(
  token: string,
): Promise<PlaylistsResponse> {
  const result = await fetch(
    "https://api.spotify.com/v1/me/playlists?limit=50",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return await result.json();
}

export async function fetchTopArtists(
  token: string,
  limit: number = 20,
  offset: number = 0,
): Promise<TopArtistsResponse> {
  const result = await fetch(
    `https://api.spotify.com/v1/me/top/artists?limit=${limit}&offset=${offset}&time_range=long_term`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return await result.json();
}

export async function fetchArtistTopTracks(
  token: string,
  artistId: string,
): Promise<TracksResponse> {
  const result = await fetch(
    `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return await result.json();
}

async function fetchArtistAlbums(
  token: string,
  artistId: string,
  limit: number = 20,
  offset: number = 0,
): Promise<AlbumsResponse> {
  const result = await fetch(
    `https://api.spotify.com/v1/artists/${artistId}/albums?limit=${limit}&offset=${offset}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return await result.json();
}

async function fetchAlbumTracks(
  token: string,
  albumId: string,
  limit: number = 30,
  offset: number = 0,
): Promise<AlbumTracksResponse> {
  const result = await fetch(
    `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=${limit}&offset=${offset}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return await result.json();
}

export async function fetchAllArtistTracks(
  token: string,
  artistId: string,
): Promise<Track[]> {
  const seenTrackIds = new Set<string>();

  // Step 1: Fetch 20 albums for the artist
  const albumsResponse = await fetchArtistAlbums(token, artistId, 20, 0);

  // Step 2: Fetch tracks for all albums in parallel (30 tracks per album)
  const albumTracksPromises = albumsResponse.items.map(async (album) => {
    const tracksResponse = await fetchAlbumTracks(token, album.id, 30, 0);
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

export async function createPlaylist(
  token: string,
  userId: string,
  name: string,
  description: string,
): Promise<Playlist> {
  const result = await fetch(
    `https://api.spotify.com/v1/users/${userId}/playlists`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        description,
        public: false,
      }),
    },
  );

  return await result.json();
}

export async function fetchFollowedArtists(
  token: string,
  limit: number = 30,
  after?: string,
): Promise<{ items: Artist[]; next: string | null; total: number }> {
  const params = new URLSearchParams({
    type: "artist",
    limit: limit.toString(),
    ...(after ? { after } : {}),
  });
  const url = `https://api.spotify.com/v1/me/following?${params}`;

  const result = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const { artists } = await result.json();
  const { items, cursors, total = 0 } = artists || {};

  if (artists?.items) {
    return {
      items,
      next: cursors?.after || null,
      total,
    };
  }

  return {
    items: [],
    next: null,
    total: 0,
  };
}

export async function addTracksToPlaylist(
  token: string,
  playlistId: string,
  trackUris: string[],
): Promise<void> {
  // Spotify API allows max 100 tracks per request
  const chunks = [];
  for (let i = 0; i < trackUris.length; i += 100) {
    chunks.push(trackUris.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uris: chunk,
      }),
    });
  }
}
