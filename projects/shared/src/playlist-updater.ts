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
 * Selects random tracks from multiple artists
 */
export function selectRandomTracks(
  artistsTracks: Map<string, Track[]>,
  trackCount: number
): Track[] {
  const allTracks: Track[] = [];

  // Flatten all tracks
  for (const tracks of artistsTracks.values()) {
    allTracks.push(...tracks);
  }

  // Shuffle and select
  const shuffled = allTracks.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(trackCount, shuffled.length));
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

  const match = description.match(/\[Auto-update:\s*([^\]]+)\]/);
  if (!match) return [];

  return match[1].split(',').map(id => id.trim()).filter(id => id.length > 0);
}
