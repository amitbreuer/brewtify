import type { PartyCandidate, PartyRequestDto, PartyRoomDto } from '@brewtify/shared';
import { PartyClient, PartyError } from '../src/features/party/api.ts';

function artwork(color: string, accent: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="12" fill="${color}"/><circle cx="100" cy="60" r="50" fill="${accent}" opacity=".8"/><path d="M0 130L75 45L160 145V160H0Z" fill="#121212" opacity=".65"/></svg>`)}`;
}

const tracks: PartyCandidate[] = [
  { id: 'demo-afterglow', title: 'Afterglow', artist: 'Northern Lines', album: 'Blue Hour', durationMs: 218000, explicit: false, url: 'https://example.invalid/demo/afterglow', artwork: artwork('#25345d', '#e59b81'), evidence: ['Same recording', 'Matching duration and version'] },
  { id: 'demo-night-drive', title: 'Night Drive', artist: 'The Satellites', album: 'City Lights', durationMs: 192000, explicit: false, url: 'https://example.invalid/demo/night-drive', artwork: artwork('#443352', '#b476c7'), evidence: ['Title and artist match', 'Host version selection required'] },
  { id: 'demo-night-drive-live', title: 'Night Drive - Live', artist: 'The Satellites', album: 'Live at the Observatory', durationMs: 238000, explicit: false, url: 'https://example.invalid/demo/night-drive-live', artwork: artwork('#443352', '#b476c7'), evidence: ['Live version', 'Longer recording'] },
  { id: 'demo-sunrise', title: 'Sunrise Again', artist: 'Sunday Club', album: 'Slow Mornings', durationMs: 204000, explicit: false, url: 'https://example.invalid/demo/sunrise', artwork: artwork('#765035', '#f6cf82'), evidence: ['Exact recording'] },
];

function sampleRequests(): PartyRequestDto[] {
  const date = new Date().toISOString();
  return [
    { id: 'demo-request-1', displayName: 'Guest', sourceUrl: tracks[0].url, selected: tracks[0], candidates: [], confidence: 'exact', status: 'added', failureCode: null, createdAt: date, updatedAt: date },
    { id: 'demo-request-2', displayName: 'Guest', sourceUrl: 'https://music.apple.com/us/song/demo/123456789', source: tracks[1], selected: tracks[1], candidates: [], confidence: 'high', status: 'added', failureCode: null, createdAt: date, updatedAt: date },
    { id: 'demo-request-3', displayName: 'You', sourceUrl: tracks[3].url, selected: tracks[3], candidates: [], confidence: 'exact', status: 'added', failureCode: null, createdAt: date, updatedAt: date },
  ];
}

// This transport never calls fetch or delegates to the authenticated Party client.
export class PartyDemoClient extends PartyClient {
  room: PartyRoomDto;
  private requests = sampleRequests();
  private revision = 1;

  constructor(isHost: boolean) {
    super();
    this.room = {
      id: 'demo-room', status: 'open', mode: 'auto',
      expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
      blockedReason: null, isHost,
    };
  }

  override async request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const route = path.split('?')[0];
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    let result: unknown;
    if (route === '/rooms/demo-room/invite' && body === undefined) {
      result = { inviteUrl: 'https://example.invalid/party-demo-not-a-real-invitation' };
    } else if (route === '/rooms/demo-room/requests' && body === undefined) {
      result = { room: this.room, requests: this.room.isHost ? this.requests : this.requests.filter(request => request.displayName === 'You'), nextCursor: String(this.revision) };
    } else if (route === '/rooms/demo-room/requests' && body !== undefined) {
      if (this.room.status !== 'open') throw new PartyError('This demo party is not accepting songs.');
      if (typeof input.url !== 'string' || !/^https:\/\/(open\.spotify\.com|music\.apple\.com)\//.test(input.url)) {
        throw new PartyError('Paste a Spotify or Apple Music song link. Demo mode never looks it up.');
      }
      const id = crypto.randomUUID();
      this.requests.push({
        id, displayName: 'You',
        sourceUrl: input.url, selected: { ...tracks[0], title: 'Your sample song', artist: 'Demo catalog - not looked up' },
        candidates: [], confidence: 'exact', status: 'added', failureCode: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      result = { id };
    } else if (route === '/rooms/demo-room/action' && body !== undefined && this.room.isHost) {
      if (input.action === 'lock') this.room.status = 'locked';
      else if (input.action === 'unlock') this.room.status = 'open';
      else if (input.action === 'close') this.room.status = 'closed';
      else if (input.action === 'mode' && (input.mode === 'auto' || input.mode === 'host_approval')) this.room.mode = input.mode;
      else throw new PartyError('That action is unavailable in this local demo.');
      result = { ok: true };
    } else if (/^\/rooms\/demo-room\/requests\/[^/]+\/action$/.test(route) && body !== undefined && this.room.isHost) {
      const request = this.requests.find(item => item.id === route.split('/')[4]);
      if (!request) throw new PartyError('Demo request not found.');
      if (input.action === 'approve' && request.selected) request.status = 'added';
      else if (input.action === 'reject') request.status = 'rejected';
      else if (input.action === 'select') {
        const candidate = request.candidates.find(item => item.id === input.candidateId);
        if (!candidate) throw new PartyError('Choose one of the sample versions.');
        request.selected = candidate;
        request.status = 'added';
      } else throw new PartyError('That action is unavailable in this local demo.');
      request.updatedAt = new Date(Math.max(Date.now(), Date.parse(request.updatedAt) + 1)).toISOString();
      result = { ok: true };
    } else {
      throw new PartyError('Demo mode does not call real Party APIs or authorize Spotify.');
    }
    if (body !== undefined) this.revision++;
    return structuredClone(result) as T;
  }
}
