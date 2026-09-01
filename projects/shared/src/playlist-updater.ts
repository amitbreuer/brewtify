export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
  album?: { release_date?: string | null } | null;
}

export interface SelectTracksOptions {
  /** Per-artist share of the playlist, e.g. { artistId: 40 }. Omitted artists get 0. */
  weights?: Map<string, number>;
  /** Per-artist era bias: 0 = oldest releases, 50 = no bias, 100 = newest releases. */
  eraPreferences?: Map<string, number>;
}

const NEUTRAL_ERA = 50;

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
 * Splits quotas across artists proportionally to their weights using the
 * largest-remainder method, then redistributes any quota an artist cannot
 * fill (because it has too few tracks) across the artists that still have
 * spare capacity. This keeps the requested percentages accurate instead of
 * dumping every rounding error and shortfall onto the last artist.
 */
function allocateQuotas(
  entries: Array<[string, Track[]]>,
  trackCount: number,
  weights?: Map<string, number>
): number[] {
  const count = entries.length;
  const quotas = new Array<number>(count).fill(0);
  if (count === 0 || trackCount <= 0) return quotas;

  const capacity = entries.map(([, tracks]) => tracks.length);
  const totalCapacity = capacity.reduce((sum, c) => sum + c, 0);
  const target = Math.min(trackCount, totalCapacity);
  if (target <= 0) return quotas;

  let shares: number[];
  if (weights && weights.size > 0) {
    shares = entries.map(([artistId]) => Math.max(0, weights.get(artistId) ?? 0));
    if (shares.reduce((sum, s) => sum + s, 0) <= 0) shares = new Array(count).fill(1);
  } else {
    shares = new Array(count).fill(1);
  }

  let remaining = target;
  // Artists still eligible to receive quota (weight > 0 and unfilled capacity).
  let eligible = shares.map((share, i) => share > 0 && capacity[i] > 0);

  while (remaining > 0) {
    const activeShare = shares.reduce((sum, s, i) => (eligible[i] ? sum + s : sum), 0);
    if (activeShare <= 0) break;

    const exact = shares.map((s, i) => (eligible[i] ? (s / activeShare) * remaining : 0));
    const granted = exact.map((e) => Math.floor(e));

    // Largest-remainder: hand out the leftover units to the biggest fractions.
    let leftover = remaining - granted.reduce((sum, g) => sum + g, 0);
    const byRemainder = exact
      .map((e, i) => ({ i, frac: e - Math.floor(e) }))
      .filter(({ i }) => eligible[i])
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; leftover > 0 && byRemainder.length > 0; k++) {
      granted[byRemainder[k % byRemainder.length].i]++;
      leftover--;
    }

    // Clamp to what each artist can actually supply.
    let placed = 0;
    for (let i = 0; i < count; i++) {
      if (!eligible[i] || granted[i] <= 0) continue;
      const room = capacity[i] - quotas[i];
      const give = Math.min(granted[i], room);
      quotas[i] += give;
      placed += give;
    }

    remaining -= placed;
    eligible = eligible.map((ok, i) => ok && quotas[i] < capacity[i]);
    // Nothing could be placed this round — avoid spinning forever.
    if (placed === 0) break;
  }

  // Any residue left because every weighted artist is full: spill over to the
  // remaining artists so the playlist still reaches the requested length.
  if (remaining > 0) {
    for (let i = 0; i < count && remaining > 0; i++) {
      const room = capacity[i] - quotas[i];
      const give = Math.min(room, remaining);
      quotas[i] += give;
      remaining -= give;
    }
  }

  return quotas;
}

/**
 * Weighted sampling without replacement (Efraimidis-Spirakis) biased towards
 * one end of the artist's release timeline. Era 50 means no bias at all, and
 * the bias ramps up continuously towards 0 (oldest) or 100 (newest), so the
 * selection stays random while still honouring the slider.
 */
function selectWithEraBias(tracks: Track[], quota: number, era: number): Track[] {
  if (quota <= 0) return [];
  if (quota >= tracks.length) return fisherYatesShuffle(tracks);

  const dated = tracks.filter((t) => !!t.album?.release_date);
  const undated = tracks.filter((t) => !t.album?.release_date);

  if (era === NEUTRAL_ERA || dated.length < 2) {
    return fisherYatesShuffle(tracks).slice(0, quota);
  }

  const sorted = [...dated].sort((a, b) =>
    (a.album!.release_date as string).localeCompare(b.album!.release_date as string)
  );

  const preferNewer = era > NEUTRAL_ERA;
  // 0 at era 50, 1 at era 0 or 100 — keeps the transition smooth.
  const strength = Math.abs(era - NEUTRAL_ERA) / NEUTRAL_ERA;

  const scored = sorted.map((track, idx) => {
    const position = idx / (sorted.length - 1); // 0 = oldest, 1 = newest
    const affinity = preferNewer ? position : 1 - position;
    const weight = 1 - strength + strength * Math.pow(affinity, 3);
    // Efraimidis-Spirakis key: random^(1/weight); higher weight => higher key.
    const key = weight <= 0 ? 0 : Math.pow(Math.random(), 1 / weight);
    return { track, key };
  });

  scored.sort((a, b) => b.key - a.key);
  const picked = scored.slice(0, quota).map((s) => s.track);

  // Backfill from tracks with no release date if the dated pool ran short.
  if (picked.length < quota && undated.length > 0) {
    picked.push(...fisherYatesShuffle(undated).slice(0, quota - picked.length));
  }

  return picked;
}

/**
 * Selects random tracks from multiple artists, honouring the configured
 * per-artist percentage split and per-artist era preference.
 *
 * - `weights` controls how many of the `trackCount` slots each artist gets.
 *   Without weights every artist gets an equal share.
 * - `eraPreferences` biases each artist's own picks towards older or newer
 *   releases (0 = oldest, 50 = no bias, 100 = newest).
 */
export function selectRandomTracks(
  artistsTracks: Map<string, Track[]>,
  trackCount: number,
  weightsOrOptions?: Map<string, number> | SelectTracksOptions
): Track[] {
  if (artistsTracks.size === 0 || trackCount <= 0) return [];

  const options: SelectTracksOptions =
    weightsOrOptions instanceof Map
      ? { weights: weightsOrOptions }
      : weightsOrOptions ?? {};
  const { weights, eraPreferences } = options;

  const entries = Array.from(artistsTracks.entries());
  const quotas = allocateQuotas(entries, trackCount, weights);

  const selected: Track[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [artistId, tracks] = entries[i];
    const era = eraPreferences?.get(artistId) ?? NEUTRAL_ERA;
    selected.push(...selectWithEraBias(tracks, quotas[i], era));
  }

  return fisherYatesShuffle(selected);
}
