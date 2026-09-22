import { createPrivateKey, sign } from 'node:crypto';
import type { PartyCandidate, PartyConfidence, PartyTrack } from '@brewtify/shared';
import {
  providerRequest, ProviderTransportError, SPOTIFY_TRACK_ID, SpotifyError,
  trackEligibility, type SpotifyTrack,
} from '@brewtify/spotify';

export { assertTrackEligible, trackEligibility } from '@brewtify/spotify';

export interface SongLink {
  provider: 'spotify' | 'apple_music';
  id: string;
  storefront?: string;
  url: string;
}

export class CatalogError extends Error {
  constructor(
    public readonly code: 'invalid_song_link' | 'apple_configuration' | 'apple_unauthorized'
      | 'apple_rate_limited' | 'apple_unavailable' | 'apple_invalid_response' | 'apple_rejected',
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`Song catalog failed: ${code}`);
    this.name = 'CatalogError';
  }
}

const APPLE_ID = /^[1-9]\d{0,19}$/;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const MATCH_DURATION_TOLERANCE_MS = 2_000;
export const MAX_MATCH_CANDIDATES = 10;

export function parseSongLink(input: string): SongLink {
  const fail = (): never => { throw new CatalogError('invalid_song_link'); };
  if (typeof input !== 'string' || input.length > 2048) return fail();
  const text = input.trim();
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return { provider: 'spotify', id: uri[1], url: `https://open.spotify.com/track/${uri[1]}` };
  // URL parsers normalize backslashes, controls and dot paths; reject them before parsing.
  if (!text || /[\u0000-\u0020\u007f\\]/.test(text) || !/^https:\/\//i.test(text)) return fail();
  let url: URL;
  try { url = new URL(text); } catch { return fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return fail();
  const authority = text.slice(text.indexOf('://') + 3).split(/[/?#]/, 1)[0];
  if (!/^(open\.spotify\.com|music\.apple\.com)$/i.test(authority)) return fail();
  const rawPath = text.slice(text.indexOf(authority) + authority.length).split(/[?#]/, 1)[0];
  if (rawPath !== url.pathname || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return fail();
  if (url.hostname === 'open.spotify.com') {
    const match = /^\/(?:intl-[a-z]{2}(?:-[A-Z]{2})?\/)?track\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
    if (!match) return fail();
    return { provider: 'spotify', id: match[1], url: `https://open.spotify.com/track/${match[1]}` };
  }
  if (url.hostname !== 'music.apple.com') return fail();
  const match = /^\/([a-z]{2})\/(song|album)\/(?:([^/]+)\/)?([1-9]\d{0,19})\/?$/.exec(url.pathname);
  if (!match) return fail();
  if (match[3]) {
    try {
      if (/[/\\\u0000-\u001f\u007f]/.test(decodeURIComponent(match[3]))) return fail();
    } catch { return fail(); }
  }
  const ids = url.searchParams.getAll('i');
  let id = match[4];
  if (match[2] === 'album') {
    if (ids.length !== 1 || !APPLE_ID.test(ids[0])) return fail();
    id = ids[0];
  } else if (ids.length > 0) {
    // A song route with a second identifier is ambiguous, even if they happen to agree.
    return fail();
  }
  return {
    provider: 'apple_music', id, storefront: match[1],
    url: `https://music.apple.com/${match[1]}/song/${id}`,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function appleDeveloperToken(): string {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  if (!teamId || !keyId || !privateKey || !/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Z0-9]{10}$/.test(keyId)) {
    throw new CatalogError('apple_configuration');
  }
  try {
    const key = createPrivateKey(privateKey.replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('Expected a P-256 signing key');
    }
    const now = Math.floor(Date.now() / 1000);
    const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
    const unsigned = `${encode({ alg: 'ES256', kid: keyId })}.${encode({ iss: teamId, iat: now, exp: now + 300 })}`;
    return `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  } catch {
    throw new CatalogError('apple_configuration');
  }
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

async function appleSong(link: SongLink): Promise<PartyTrack | undefined> {
  const token = appleDeveloperToken();
  let response;
  try {
    response = await providerRequest('apple', `catalog/${link.storefront}/songs/${link.id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  } catch (error) {
    if (error instanceof ProviderTransportError) {
      throw new CatalogError(error.code === 'network' ? 'apple_unavailable' : 'apple_invalid_response', error.status);
    }
    throw error;
  }
  if (response.status === 404) return undefined;
  if (response.status === 401 || response.status === 403) throw new CatalogError('apple_unauthorized', response.status);
  if (response.status === 429) throw new CatalogError('apple_rate_limited', 429, response.retryAfterSeconds ?? 60);
  if (response.status >= 500) throw new CatalogError('apple_unavailable', response.status);
  if (response.status !== 200) throw new CatalogError('apple_rejected', response.status);
  const data = record(response.body).data;
  if (!Array.isArray(data) || data.length > 1) throw new CatalogError('apple_invalid_response');
  if (!data.length) return undefined;
  const song = record(data[0]);
  const attributes = record(song.attributes);
  if (song.id !== link.id || song.type !== 'songs'
    || typeof attributes.name !== 'string' || !attributes.name || attributes.name.length > 1000
    || typeof attributes.artistName !== 'string' || !attributes.artistName || attributes.artistName.length > 1000
    || typeof attributes.albumName !== 'string' || attributes.albumName.length > 1000
    || (attributes.durationInMillis !== undefined && (typeof attributes.durationInMillis !== 'number'
      || !Number.isFinite(attributes.durationInMillis) || attributes.durationInMillis <= 0))
    || (attributes.contentRating !== undefined && !['explicit', 'clean'].includes(String(attributes.contentRating)))) {
    throw new CatalogError('apple_invalid_response');
  }
  if (attributes.isrc !== undefined && (typeof attributes.isrc !== 'string' || !ISRC.test(attributes.isrc.toUpperCase()))) {
    throw new CatalogError('apple_invalid_response');
  }
  const rawArtwork = record(attributes.artwork).url;
  return {
    id: link.id, title: attributes.name, artist: attributes.artistName, album: attributes.albumName,
    durationMs: typeof attributes.durationInMillis === 'number' ? attributes.durationInMillis : 0,
    // Apple omits contentRating on unrated tracks; omission is not evidence of "clean".
    explicit: attributes.contentRating === 'explicit' ? true : attributes.contentRating === 'clean' ? false : null,
    isrc: typeof attributes.isrc === 'string' && ISRC.test(attributes.isrc.toUpperCase()) ? attributes.isrc.toUpperCase() : undefined,
    url: link.url,
    artwork: safeArtwork(typeof rawArtwork === 'string' ? rawArtwork.replace('{w}', '300').replace('{h}', '300') : undefined),
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
  const source = await appleSong(link);
  if (!source) return { source: unavailableSource(link), candidates: [], confidence: 'no_match' };
  const tracks: SpotifyTrack[] = [];
  if (source.isrc) tracks.push(...await spotifyClient.search(token, `isrc:${source.isrc}`));
  // Quote boundaries and field operators cannot come from provider metadata.
  const searchText = (text: string) => normalized(text).slice(0, 250);
  tracks.push(...await spotifyClient.search(token, `track:"${searchText(source.title)}" artist:"${searchText(source.artist)}"`));
  return matchCandidates(source, tracks);
}
