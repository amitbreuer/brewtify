export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
}

export interface PlaylistConfig {
  playlistId: string;
  playlistName: string;
  artistIds: string[];
  trackCount: number;
  enabled: boolean;
  createdAt: string;
  lastUpdatedAt?: string;
}

export interface SpotifyClient {
  getAllArtistTracks(accessToken: string, artistId: string): Promise<Track[]>;
  addTracksToPlaylist(accessToken: string, playlistId: string, trackUris: string[]): Promise<void>;
  replacePlaylistTracks(accessToken: string, playlistId: string, trackUris: string[]): Promise<void>;
}

/**
 * Fisher-Yates shuffle — produces a uniformly random permutation
 */
function fisherYatesShuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Selects random tracks from multiple artists with equal per-artist weighting.
 * Each artist gets an equal quota of tracks, and a proper Fisher-Yates shuffle
 * ensures good distribution across albums.
 */
export function selectRandomTracks(
  artistsTracks: Map<string, Track[]>,
  trackCount: number
): Track[] {
  const artistCount = artistsTracks.size;
  if (artistCount === 0) return [];

  const tracksPerArtist = Math.floor(trackCount / artistCount);
  const remainder = trackCount % artistCount;

  const selected: Track[] = [];
  let artistIndex = 0;

  for (const tracks of artistsTracks.values()) {
    const quota = tracksPerArtist + (artistIndex < remainder ? 1 : 0);
    const shuffled = fisherYatesShuffle(tracks);
    selected.push(...shuffled.slice(0, quota));
    artistIndex++;
  }

  return fisherYatesShuffle(selected);
}

/**
 * Fetches tracks for all artists and fills the playlist
 */
export async function fillPlaylist(
  spotifyClient: SpotifyClient,
  accessToken: string,
  playlistId: string,
  artistIds: string[],
  trackCount: number,
  replaceExisting: boolean = false
): Promise<{ success: boolean; trackCount: number; error?: string }> {
  try {
    // Fetch tracks for all artists in parallel
    const trackPromises = artistIds.map((artistId) =>
      spotifyClient.getAllArtistTracks(accessToken, artistId)
    );

    const results = await Promise.allSettled(trackPromises);

    // Collect tracks by artist
    const artistsTracks = new Map<string, Track[]>();
    artistIds.forEach((artistId, index) => {
      const result = results[index];
      if (result.status === 'fulfilled') {
        artistsTracks.set(artistId, result.value);
      }
    });

    // Select random tracks
    const selectedTracks = selectRandomTracks(artistsTracks, trackCount);

    if (selectedTracks.length === 0) {
      return {
        success: false,
        trackCount: 0,
        error: 'No tracks found for selected artists',
      };
    }

    // Get track URIs
    const trackUris = selectedTracks.map((track) => track.uri);

    // Update playlist
    if (replaceExisting) {
      await spotifyClient.replacePlaylistTracks(accessToken, playlistId, trackUris);
    } else {
      await spotifyClient.addTracksToPlaylist(accessToken, playlistId, trackUris);
    }

    return {
      success: true,
      trackCount: selectedTracks.length,
    };
  } catch (error) {
    return {
      success: false,
      trackCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Decodes artist IDs from a playlist description
 * Looks for pattern: [Auto-update: id1,id2,id3]
 */
export function parseArtistIdsFromDescription(description: string | null | undefined): string[] {
  if (!description) return [];

  // Try new format first: [Auto-update: id1,id2,id3]
  let match = description.match(/\[Auto-update:\s*([^\]]+)\]/);
  if (match) {
    return match[1].split(',').map(id => id.trim()).filter(id => id.length > 0);
  }

  // Fallback to old format: ARTISTS:id1,id2,id3
  match = description.match(/ARTISTS:([a-zA-Z0-9,]+)/);
  if (match) {
    return match[1].split(',').filter(Boolean);
  }

  return [];
}
