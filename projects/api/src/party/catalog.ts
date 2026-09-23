import type { PartyCandidate, PartyConfidence, PartyTrack } from '@brewtify/shared';
import { InvalidSongLink, parsePartySongLink, type SongLink } from '@brewtify/shared';
import {
  providerRequest, ProviderTransportError, SPOTIFY_TRACK_ID, SpotifyError,
  trackEligibility, type SpotifyTrack,
} from '@brewtify/spotify';

export { assertTrackEligible, trackEligibility } from '@brewtify/spotify';

export type { SongLink } from '@brewtify/shared';

export class CatalogError extends Error {
  constructor(
    public readonly code: 'invalid_song_link' | 'itunes_rate_limited'
      | 'itunes_unavailable' | 'itunes_invalid_response' | 'itunes_rejected',
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`Song catalog failed: ${code}`);
    this.name = 'CatalogError';
  }
}

const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const MATCH_DURATION_TOLERANCE_MS = 2_000;
export const MAX_MATCH_CANDIDATES = 10;

export function parseSongLink(input: string): SongLink {
  try {
    return parsePartySongLink(input);
  } catch (error) {
    if (error instanceof InvalidSongLink) throw new CatalogError('invalid_song_link');
    throw error;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function safeArtwork(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    // Only artwork CDNs, never a submitted or arbitrary provider-controlled URL.
    if (!(url.hostname.endsWith('.mzstatic.com') || url.hostname === 'i.scdn.co')) return undefined;
    return url.toString();
  } catch { return undefined; }
}

async function itunesSong(link: Extract<SongLink, { provider: 'apple_music' }>): Promise<PartyTrack | undefined> {
  let response;
  try {
    const query = new URLSearchParams({ id: link.id, country: link.storefront });
    response = await providerRequest('itunes', `lookup?${query}`, {
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (error instanceof ProviderTransportError) {
      throw new CatalogError(error.code === 'network' ? 'itunes_unavailable' : 'itunes_invalid_response', error.status);
    }
    throw error;
  }
  if (response.status === 404) return undefined;
  if (response.status === 429) throw new CatalogError('itunes_rate_limited', 429, response.retryAfterSeconds ?? 60);
  if (response.status >= 500) throw new CatalogError('itunes_unavailable', response.status);
  if (response.status !== 200) throw new CatalogError('itunes_rejected', response.status);
  const body = record(response.body);
  const results = body.results;
  if (!Array.isArray(results) || results.length > 1 || body.resultCount !== results.length) {
    throw new CatalogError('itunes_invalid_response');
  }
  if (!results.length) return undefined;
  const song = record(results[0]);
  if (!Number.isSafeInteger(song.trackId) || String(song.trackId) !== link.id || song.kind !== 'song'
    || song.wrapperType !== 'track'
    || typeof song.trackName !== 'string' || !song.trackName.trim() || song.trackName.length > 1000
    || typeof song.artistName !== 'string' || !song.artistName.trim() || song.artistName.length > 1000
    || (song.collectionName !== undefined && (typeof song.collectionName !== 'string' || song.collectionName.length > 1000))
    || (song.trackTimeMillis !== undefined && (typeof song.trackTimeMillis !== 'number'
      || !Number.isSafeInteger(song.trackTimeMillis) || song.trackTimeMillis <= 0))
    || (song.trackExplicitness !== undefined && (typeof song.trackExplicitness !== 'string'
      || !['explicit', 'cleaned', 'notExplicit'].includes(song.trackExplicitness)))) {
    throw new CatalogError('itunes_invalid_response');
  }
  return {
    id: link.id, title: song.trackName, artist: song.artistName,
    album: typeof song.collectionName === 'string' ? song.collectionName : '',
    durationMs: typeof song.trackTimeMillis === 'number' ? song.trackTimeMillis : 0,
    // Album ratings are not track evidence. iTunes does not supply recording ISRCs.
    explicit: song.trackExplicitness === 'explicit' ? true
      : song.trackExplicitness === 'cleaned' || song.trackExplicitness === 'notExplicit' ? false : null,
    url: link.url,
    artwork: safeArtwork(song.artworkUrl100),
  };
}

export interface CatalogSpotifyClient {
  track(token: string, id: string): Promise<SpotifyTrack>;
  search(token: string, query: string): Promise<SpotifyTrack[]>;
}

export interface SongResolution {
  source: PartyTrack;
  candidates: PartyCandidate[];
  selected?: PartyCandidate;
  confidence: PartyConfidence;
}

function spotifyMetadata(track: SpotifyTrack): PartyTrack {
  return {
    id: track.id, title: track.name, artist: track.artists.map(artist => artist.name).join(', '),
    album: track.album.name, durationMs: track.duration_ms ?? 0, explicit: track.explicit ?? null,
    isrc: track.external_ids?.isrc?.toUpperCase(),
    url: `https://open.spotify.com/track/${track.id}`,
    artwork: safeArtwork(track.album.images?.[0]?.url),
  };
}

function normalized(text: string): string {
  // No qualifier removal, transliteration or fuzzy artist/title similarity.
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const VERSION = /\b(live|remaster(?:ed)?|remix(?:ed)?|mix|radio|edit|acoustic|instrumental|karaoke|demo|mono|stereo|extended|clean|explicit|censored|uncensored|sped|slowed|reverb|version|english|spanish|french|german|italian|portuguese|japanese|korean|chinese|hebrew|arabic)\b/;

function versionsContradict(source: PartyTrack, candidate: PartyTrack): boolean {
  if (normalized(source.title) !== normalized(candidate.title)) return true;
  const sourceAlbum = normalized(source.album);
  const candidateAlbum = normalized(candidate.album);
  // A version-bearing album supplies recording evidence even when the title does not.
  return sourceAlbum !== candidateAlbum && (VERSION.test(sourceAlbum) || VERSION.test(candidateAlbum));
}

export function matchCandidates(source: PartyTrack, tracks: SpotifyTrack[]): SongResolution {
  const candidates: PartyCandidate[] = [];
  const safe: { candidate: PartyCandidate; confidence: 'exact' | 'high' }[] = [];
  const seen = new Set<string>();
  const signatures = new Map<string, string>();
  const inconsistent = new Set<string>();
  const boundedTracks = tracks.slice(0, MAX_MATCH_CANDIDATES * 2);
  for (const track of boundedTracks) {
    const signature = JSON.stringify([
      spotifyMetadata(track), track.is_playable, track.restrictions, track.linked_from, track.is_local,
    ]);
    const previous = signatures.get(track.id);
    if (previous !== undefined && previous !== signature) inconsistent.add(track.id);
    signatures.set(track.id, signature);
  }
  for (const track of boundedTracks) {
    if (seen.has(track.id) || !trackEligibility(track).eligible) continue;
    seen.add(track.id);
    const candidate = spotifyMetadata(track);
    if (versionsContradict(source, candidate)) continue;
    if (!source.artist || normalized(source.artist) !== normalized(candidate.artist)) continue;
    if (source.explicit !== null && candidate.explicit !== null && source.explicit !== candidate.explicit) continue;
    if (source.durationMs > 0 && candidate.durationMs > 0
      && Math.abs(source.durationMs - candidate.durationMs) > MATCH_DURATION_TOLERANCE_MS) continue;
    const sourceIsrc = source.isrc && ISRC.test(source.isrc) ? source.isrc : undefined;
    const candidateIsrc = candidate.isrc && ISRC.test(candidate.isrc) ? candidate.isrc : undefined;
    if (sourceIsrc && candidateIsrc && sourceIsrc !== candidateIsrc) continue;
    const evidence = ['same_title_and_artist', 'playable'];
    const sameIsrc = Boolean(sourceIsrc && candidateIsrc && sourceIsrc === candidateIsrc);
    if (sameIsrc) evidence.push('same_isrc');
    const durationKnown = source.durationMs > 0 && candidate.durationMs > 0;
    if (durationKnown) evidence.push('duration_within_2000ms');
    const explicitKnown = source.explicit !== null && candidate.explicit !== null;
    if (explicitKnown) evidence.push('same_explicitness');
    const albumKnown = Boolean(source.album && candidate.album);
    const sameAlbum = albumKnown && normalized(source.album) === normalized(candidate.album);
    if (sameAlbum) evidence.push('same_album');
    const result = { ...candidate, evidence };
    candidates.push(result);
    if (inconsistent.has(track.id)) {
      evidence.push('inconsistent_provider_metadata');
      continue;
    }
    // Missing recording ID evidence cannot be silently filled by another recording.
    const isrcEvidenceComplete = Boolean(sameIsrc || (!source.isrc && !candidate.isrc));
    if (durationKnown && explicitKnown && albumKnown && isrcEvidenceComplete && (sameIsrc || sameAlbum)) {
      safe.push({ candidate: result, confidence: sameIsrc ? 'exact' : 'high' });
    } else {
      evidence.push('incomplete_evidence');
    }
  }
  const bounded = candidates.slice(0, MAX_MATCH_CANDIDATES);
  // No fuzzy scoring or arbitrary tie-breaking: every viable alternative prevents auto-selection.
  if (tracks.length <= MAX_MATCH_CANDIDATES * 2 && candidates.length === 1 && safe.length === 1) {
    return { source, candidates: bounded, selected: safe[0].candidate, confidence: safe[0].confidence };
  }
  return { source, candidates: bounded, confidence: candidates.length ? 'ambiguous' : 'no_match' };
}

function unavailableSource(link: SongLink): PartyTrack {
  return { id: link.id, title: 'Unavailable song', artist: '', album: '', durationMs: 0, explicit: null, url: link.url };
}

export async function resolveSong(input: string, token: string, spotifyClient: CatalogSpotifyClient): Promise<SongResolution> {
  const link = parseSongLink(input);
  if (link.provider === 'spotify') {
    let track: SpotifyTrack;
    try { track = await spotifyClient.track(token, link.id); } catch (error) {
      if (error instanceof SpotifyError && error.code === 'not_found') {
        return { source: unavailableSource(link), candidates: [], confidence: 'no_match' };
      }
      throw error;
    }
    const source = { ...spotifyMetadata(track), id: link.id, url: link.url };
    if (!trackEligibility(track, link.id).eligible) return { source, candidates: [], confidence: 'no_match' };
    const selected = { ...source, evidence: ['direct_spotify_id', 'playable', 'not_relinked'] };
    return { source, candidates: [selected], selected, confidence: 'exact' };
  }
  const source = await itunesSong(link);
  if (!source) return { source: unavailableSource(link), candidates: [], confidence: 'no_match' };
  const tracks: SpotifyTrack[] = [];
  // Quote boundaries and field operators cannot come from provider metadata.
  const searchText = (text: string) => normalized(text).slice(0, 250);
  tracks.push(...await spotifyClient.search(token, `track:"${searchText(source.title)}" artist:"${searchText(source.artist)}"`));
  return matchCandidates(source, tracks);
}
