export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
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
 * Selects random tracks from multiple artists with configurable per-artist weighting.
 * If weights are provided, each artist gets tracks proportional to their weight percentage.
 * If no weights, each artist gets an equal quota. A proper Fisher-Yates shuffle
 * ensures good distribution across albums.
 */
export function selectRandomTracks(
  artistsTracks: Map<string, Track[]>,
  trackCount: number,
  weights?: Map<string, number>
): Track[] {
  const artistCount = artistsTracks.size;
  if (artistCount === 0) return [];

  const selected: Track[] = [];

  if (weights && weights.size > 0) {
    // Normalize weights to sum to 100
    const totalWeight = Array.from(weights.values()).reduce((sum, w) => sum + w, 0);
    let allocated = 0;
    const entries = Array.from(artistsTracks.entries());

    for (let i = 0; i < entries.length; i++) {
      const [artistId, tracks] = entries[i];
      const weight = weights.get(artistId) || 0;
      const quota = i === entries.length - 1
        ? trackCount - allocated // last artist gets the remainder
        : Math.round((weight / totalWeight) * trackCount);
      const shuffled = fisherYatesShuffle(tracks);
      selected.push(...shuffled.slice(0, quota));
      allocated += Math.min(quota, shuffled.length);
    }
  } else {
    // Equal distribution
    const tracksPerArtist = Math.floor(trackCount / artistCount);
    const remainder = trackCount % artistCount;
    let artistIndex = 0;

    for (const tracks of artistsTracks.values()) {
      const quota = tracksPerArtist + (artistIndex < remainder ? 1 : 0);
      const shuffled = fisherYatesShuffle(tracks);
      selected.push(...shuffled.slice(0, quota));
      artistIndex++;
    }
  }

  return fisherYatesShuffle(selected);
}
