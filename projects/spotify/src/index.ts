import type { PartyCandidate, PartyDevice } from '@brewtify/shared';
import { Agent } from 'undici';
import { createProviderLookup } from './network';

export const PARTY_SPOTIFY_SCOPES = ['user-modify-playback-state'] as const;
export const SPOTIFY_TRACK_ID = /^[A-Za-z0-9]{22}$/;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i;
export const PROVIDER_DEADLINE_MS = 8_000;
export const PROVIDER_BODY_LIMIT = 1_048_576;
const providerDispatcher = new Agent({
  connect: { lookup: createProviderLookup(), timeout: PROVIDER_DEADLINE_MS },
  connections: 10,
  pipelining: 1,
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
});

export interface SpotifyAuthorizationOptions {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge?: string;
}

export function buildSpotifyAuthorizationUrl(options: SpotifyAuthorizationOptions): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    response_type: 'code',
    redirect_uri: options.redirectUri,
    scope: options.scopes.join(' '),
    state: options.state,
  });
  if (options.codeChallenge !== undefined) {
    params.set('code_challenge', options.codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `https://accounts.spotify.com/authorize?${params}`;
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scopes: string[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images?: { url: string }[] };
  duration_ms?: number;
  explicit?: boolean;
  external_ids?: { isrc?: string };
  is_playable?: boolean;
  restrictions?: { reason?: string };
  linked_from?: { id?: string };
  is_local?: boolean;
}

export type SpotifyErrorCode =
  | 'configuration' | 'invalid_input' | 'network' | 'provider_unavailable'
  | 'rate_limited' | 'unauthorized' | 'invalid_grant' | 'forbidden'
  | 'premium_required' | 'insufficient_scope' | 'device_unavailable'
  | 'not_found' | 'redirect_rejected' | 'invalid_response' | 'provider_rejected'
  | 'track_unavailable' | 'recording_changed';

export class SpotifyError extends Error {
  constructor(
    public readonly code: SpotifyErrorCode,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
    public readonly unknownDelivery = false,
  ) {
    super(`Spotify request failed: ${code}`);
    this.name = 'SpotifyError';
  }
}

const BASES = {
  spotify: 'https://api.spotify.com/v1/',
  oauth: 'https://accounts.spotify.com/api/',
  apple: 'https://api.music.apple.com/v1/',
} as const;

export class ProviderTransportError extends Error {
  constructor(
    public readonly code: 'network' | 'redirect_rejected' | 'invalid_response',
    public readonly status?: number,
  ) {
    super(`Provider transport failed: ${code}`);
  }
}

export interface ProviderResponse {
  status: number;
  body: unknown;
  retryAfterSeconds?: number;
}

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

/**
 * Server-only, fixed-origin transport shared with the official Apple catalog.
 * Exactly one fetch: durable callers decide read retries and 429 scheduling.
 */
export async function providerRequest(
  service: keyof typeof BASES,
  path: string,
  init: RequestInit,
): Promise<ProviderResponse> {
  const base = new URL(BASES[service]);
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password) {
    throw new ProviderTransportError('invalid_response');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_DEADLINE_MS);
  let status: number | undefined;
  let retryAfterSeconds: number | undefined;
  try {
    const options: RequestInit & { dispatcher: typeof providerDispatcher } = {
      ...init, dispatcher: providerDispatcher, redirect: 'manual', signal: controller.signal,
    };
    const response = await fetch(url, options);
    status = response.status;
    if (status >= 300 && status < 400) {
      await response.body?.cancel();
      throw new ProviderTransportError('redirect_rejected', status);
    }
    retryAfterSeconds = retryAfter(response.headers.get('retry-after'));
    if (status === 204) return { status, body: undefined, retryAfterSeconds };
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > PROVIDER_BODY_LIMIT) {
      await response.body?.cancel();
      throw new ProviderTransportError('invalid_response', status);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > PROVIDER_BODY_LIMIT) {
            await reader.cancel();
            throw new ProviderTransportError('invalid_response', status);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // A definite rejection (notably 429) remains definite even without JSON.
      if (status >= 400) return { status, body: undefined, retryAfterSeconds };
      throw new ProviderTransportError('invalid_response', status);
    }
    return { status, body, retryAfterSeconds };
  } catch (error) {
    // Once a 4xx rejection is received, a broken/oversized body cannot turn it
    // into an uncertain write. In particular retain 429's durable retry delay.
    if (status !== undefined && status >= 400 && status < 500) {
      return { status, body: undefined, retryAfterSeconds };
    }
    if (error instanceof ProviderTransportError) throw error;
    throw new ProviderTransportError('network', status);
  } finally {
    clearTimeout(timer);
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function decodeTrack(value: unknown): SpotifyTrack {
  const track = object(value);
  const album = object(track.album);
  if (typeof track.id !== 'string' || !SPOTIFY_TRACK_ID.test(track.id)
    || typeof track.name !== 'string' || !track.name || track.name.length > 1000
    || !Array.isArray(track.artists) || !track.artists.length || track.artists.length > 100
    || track.artists.some(artist => typeof object(artist).name !== 'string'
      || !object(artist).name || String(object(artist).name).length > 1000)
    || typeof album.name !== 'string' || album.name.length > 1000) {
    throw new SpotifyError('invalid_response');
  }
  if ((track.duration_ms !== undefined && (typeof track.duration_ms !== 'number' || !Number.isFinite(track.duration_ms) || track.duration_ms <= 0))
    || (track.explicit !== undefined && typeof track.explicit !== 'boolean')
    || (track.is_playable !== undefined && typeof track.is_playable !== 'boolean')
    || (track.is_local !== undefined && typeof track.is_local !== 'boolean')
    || (track.restrictions !== undefined && (track.restrictions === null
      || typeof track.restrictions !== 'object' || Array.isArray(track.restrictions)))
    || (track.linked_from !== undefined && (track.linked_from === null
      || typeof track.linked_from !== 'object' || Array.isArray(track.linked_from)))
    || (object(track.external_ids).isrc !== undefined
      && (typeof object(track.external_ids).isrc !== 'string' || !ISRC.test(String(object(track.external_ids).isrc))))) {
    throw new SpotifyError('invalid_response');
  }
  // Keep market/relinking evidence rather than normalizing it away.
  return {
    id: track.id,
    name: track.name,
    artists: track.artists.map(artist => ({ name: String(object(artist).name) })),
    album: {
      name: album.name,
      images: Array.isArray(album.images) ? album.images.flatMap(image => {
        const url = object(image).url;
        return typeof url === 'string' ? [{ url }] : [];
      }).slice(0, 3) : undefined,
    },
    duration_ms: track.duration_ms as number | undefined,
    explicit: track.explicit as boolean | undefined,
    is_playable: track.is_playable as boolean | undefined,
    is_local: track.is_local as boolean | undefined,
    restrictions: track.restrictions as SpotifyTrack['restrictions'],
    linked_from: track.linked_from as SpotifyTrack['linked_from'],
    external_ids: typeof object(track.external_ids).isrc === 'string'
      ? { isrc: object(track.external_ids).isrc as string } : undefined,
  };
}

export function trackEligibility(track: SpotifyTrack, requestedId?: string): { eligible: boolean; reason?: string } {
  if (!SPOTIFY_TRACK_ID.test(track.id) || (requestedId !== undefined && track.id !== requestedId)) {
    return { eligible: false, reason: 'track_id_mismatch' };
  }
  if (track.linked_from && (!track.linked_from.id || track.linked_from.id !== track.id)) {
    return { eligible: false, reason: 'track_relinked' };
  }
  if (track.is_local || (track.restrictions && Object.keys(track.restrictions).length > 0)) {
    return { eligible: false, reason: 'track_restricted' };
  }
  if (track.is_playable !== true) return { eligible: false, reason: 'playability_unconfirmed' };
  return { eligible: true };
}

export function assertTrackEligible(track: SpotifyTrack, requestedId?: string): void {
  if (!trackEligibility(track, requestedId).eligible) throw new SpotifyError('track_unavailable');
}

export function assertSelectedRecording(track: SpotifyTrack, selected: PartyCandidate): void {
  assertTrackEligible(track, selected.id);
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const equalText = (left: string, right: string) => Boolean(normalize(left)) && normalize(left) === normalize(right);
  const isrc = track.external_ids?.isrc?.toUpperCase();
  const selectedIsrc = selected.isrc?.toUpperCase();
  if (!equalText(track.name, selected.title)
    || !equalText(track.artists.map(artist => artist.name).join(', '), selected.artist)
    || !equalText(track.album.name, selected.album)
    || typeof track.duration_ms !== 'number' || !Number.isFinite(track.duration_ms) || track.duration_ms <= 0
    || track.duration_ms !== selected.durationMs
    || typeof track.explicit !== 'boolean' || track.explicit !== selected.explicit
    || isrc !== selectedIsrc || (isrc !== undefined && !ISRC.test(isrc))) {
    throw new SpotifyError('recording_changed');
  }
}

export class SpotifyClient {
  constructor(private readonly config: { clientId: string; redirectUri: string }) {
    if (!config.clientId || !config.redirectUri) throw new SpotifyError('configuration');
    let redirect: URL;
    try { redirect = new URL(config.redirectUri); } catch { throw new SpotifyError('configuration'); }
    if (redirect.username || redirect.password || redirect.hash
      || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(redirect.hostname)))) {
      throw new SpotifyError('configuration');
    }
  }

  authorizationUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new SpotifyError('invalid_input');
    return buildSpotifyAuthorizationUrl({
      clientId: this.config.clientId, redirectUri: this.config.redirectUri,
      scopes: PARTY_SPOTIFY_SCOPES, state, codeChallenge,
    });
  }

  async exchange(code: string, verifier: string): Promise<SpotifyTokens> {
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new SpotifyError('invalid_input');
    return this.tokens({
      grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: this.config.redirectUri,
    });
  }

  async refresh(refreshToken: string): Promise<SpotifyTokens> {
    if (!refreshToken) throw new SpotifyError('invalid_input');
    return this.tokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async tokens(fields: Record<string, string>): Promise<SpotifyTokens> {
    const body = object(await this.request('oauth', 'token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, client_id: this.config.clientId }).toString(),
    }, 'read'));
    if (typeof body.access_token !== 'string' || !body.access_token
      || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0
      || typeof body.scope !== 'string'
      || (body.refresh_token !== undefined && (typeof body.refresh_token !== 'string' || !body.refresh_token))) {
      throw new SpotifyError('invalid_response');
    }
    return {
      accessToken: body.access_token, expiresIn: body.expires_in,
      refreshToken: body.refresh_token as string | undefined, scopes: body.scope.split(/\s+/).filter(Boolean),
    };
  }

  async profile(token: string): Promise<{ id: string }> {
    const body = object(await this.read('me', token));
    if (typeof body.id !== 'string' || !body.id || body.id.length > 256) throw new SpotifyError('invalid_response');
    return { id: body.id };
  }

  async devices(token: string): Promise<PartyDevice[]> {
    const body = object(await this.read('me/player/devices', token));
    if (!Array.isArray(body.devices) || body.devices.length > 100) throw new SpotifyError('invalid_response');
    return body.devices.flatMap(value => {
      const device = object(value);
      if (device.id === null) return [];
      if (typeof device.id !== 'string' || !device.id || typeof device.name !== 'string'
        || typeof device.is_active !== 'boolean' || typeof device.is_restricted !== 'boolean') {
        throw new SpotifyError('invalid_response');
      }
      return [{ id: device.id, name: device.name, isActive: device.is_active, isRestricted: device.is_restricted }];
    });
  }

  async track(token: string, id: string): Promise<SpotifyTrack> {
    if (!SPOTIFY_TRACK_ID.test(id)) throw new SpotifyError('invalid_input');
    return decodeTrack(await this.read(`tracks/${id}`, token));
  }

  async search(token: string, query: string): Promise<SpotifyTrack[]> {
    if (!query || query.length > 1000) throw new SpotifyError('invalid_input');
    const params = new URLSearchParams({ q: query, type: 'track', limit: '10' });
    const items = object(object(await this.read(`search?${params}`, token)).tracks).items;
    if (!Array.isArray(items) || items.length > 10) throw new SpotifyError('invalid_response');
    return items.map(decodeTrack);
  }

  async enqueue(token: string, trackId: string, deviceId?: string): Promise<void> {
    if (!SPOTIFY_TRACK_ID.test(trackId) || (deviceId !== undefined && (!deviceId || deviceId.length > 256 || /[\u0000-\u0020]/.test(deviceId)))) {
      throw new SpotifyError('invalid_input');
    }
    const params = new URLSearchParams({ uri: `spotify:track:${trackId}` });
    if (deviceId !== undefined) params.set('device_id', deviceId);
    await this.request('spotify', `me/player/queue?${params}`, {
      method: 'POST', headers: this.headers(token),
    }, 'queue');
  }

  private headers(token: string): Record<string, string> {
    if (!token || /[\r\n]/.test(token)) throw new SpotifyError('invalid_input');
    return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  }

  private read(path: string, token: string): Promise<unknown> {
    return this.request('spotify', path, { headers: this.headers(token) }, 'read');
  }

  private async request(service: 'spotify' | 'oauth', path: string, init: RequestInit, policy: 'read' | 'queue'): Promise<unknown> {
    const write = policy === 'queue';
    let response: ProviderResponse;
    try {
      response = await providerRequest(service, path, init);
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        throw new SpotifyError(error.code, error.status, undefined, write);
      }
      throw error;
    }
    const { status, body, retryAfterSeconds } = response;
    if (write && status === 204) return undefined;
    if (status >= 200 && status < 300) {
      if (write) throw new SpotifyError('invalid_response', status, undefined, true);
      if (body === undefined) throw new SpotifyError('invalid_response', status);
      return body;
    }
    if (status === 429) throw new SpotifyError('rate_limited', status, retryAfterSeconds ?? 60);
    if (status >= 500) throw new SpotifyError('provider_unavailable', status, undefined, write);
    if (status === 401) throw new SpotifyError('unauthorized', status);
    const error = object(body).error;
    if (error === 'invalid_grant') throw new SpotifyError('invalid_grant', status);
    const detail = object(error);
    const reason = typeof detail.reason === 'string' ? detail.reason : '';
    const message = typeof detail.message === 'string' ? detail.message.toLowerCase() : '';
    if (status === 403) {
      const code = reason === 'PREMIUM_REQUIRED' || message === 'premium required'
        ? 'premium_required'
        : reason === 'INSUFFICIENT_SCOPE' || message === 'insufficient client scope'
          ? 'insufficient_scope' : 'forbidden';
      throw new SpotifyError(code, status);
    }
    if (status === 404) throw new SpotifyError(write ? 'device_unavailable' : 'not_found', status);
    throw new SpotifyError('provider_rejected', status);
  }
}
