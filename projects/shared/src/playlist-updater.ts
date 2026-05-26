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

/**
 * Decodes artist IDs from a playlist description
 * Looks for pattern: [Auto-update: id1,id2,id3] or [Auto-update: id1:50,id2:30,id3:20]
 */
export function parseArtistIdsFromDescription(description: string | null | undefined): string[] {
  if (!description) return [];

  // Try new format first: [Auto-update: id1,id2,id3] or [Auto-update: id1:50,id2:30|era=50|count=100]
  let match = description.match(/\[Auto-update:\s*([^\]]+)\]/);
  if (match) {
    // Split on pipe first to separate artist IDs from settings
    const parts = match[1].split('|');
    return parts[0].split(',').map(id => id.split(':')[0].trim()).filter(id => id.length > 0);
  }

  // Fallback to old format: ARTISTS:id1,id2,id3
  match = description.match(/ARTISTS:([a-zA-Z0-9,]+)/);
  if (match) {
    return match[1].split(',').filter(Boolean);
  }

  return [];
}

/**
 * Parses artist weights from description.
 * Format: id1:50,id2:30,id3:20 — number after colon is the weight percentage.
 * Returns undefined if no weights are specified (equal distribution).
 */
export function parseWeightsFromDescription(description: string | null | undefined): Map<string, number> | undefined {
  if (!description) return undefined;

  const match = description.match(/\[Auto-update:\s*([^\]]+)\]/);
  if (!match) return undefined;

  const parts = match[1].split('|');
  const artistParts = parts[0].split(',').map(s => s.trim()).filter(Boolean);

  // Check if any artist has a weight specified
  const hasWeights = artistParts.some(p => p.includes(':'));
  if (!hasWeights) return undefined;

  const weights = new Map<string, number>();
  for (const part of artistParts) {
    const [id, weightStr] = part.split(':');
    if (id && weightStr) {
      weights.set(id.trim(), parseInt(weightStr) || 0);
    } else if (id) {
      // Artist without explicit weight gets 0 (will be normalized)
      weights.set(id.trim(), 0);
    }
  }

  return weights;
}
