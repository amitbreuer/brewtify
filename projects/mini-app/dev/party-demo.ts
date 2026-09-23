import { parsePartySongLink, type PartyCandidate, type PartyRequestDto, type PartyRoomDto } from '@brewtify/shared';
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
export type DemoScenario = 'match' | 'multiple' | 'not_found' | 'rate_limited' | 'failed' | 'unknown' | 'pending';

export class PartyDemoClient extends PartyClient {
  room: PartyRoomDto;
  private requests = sampleRequests();
  private revision = 1;
  private offers = new Map<string, { candidate: PartyCandidate; url: string; expires: number; id?: string }>();
  private delivery = new Map<string, number>();
  private scenario: DemoScenario;

  constructor(isHost: boolean, scenario: DemoScenario = 'match') {
    super();
    this.scenario = scenario;
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
      for (const request of this.requests) {
        if (request.status !== 'approved' || Date.now() < (this.delivery.get(request.id) ?? Infinity) || this.scenario === 'pending') continue;
        request.status = this.scenario === 'failed' || this.scenario === 'unknown' ? 'failed' : 'added';
        request.failureCode = this.scenario === 'unknown' ? 'delivery_unknown' : this.scenario === 'failed' ? 'device_unavailable' : null;
        request.updatedAt = new Date().toISOString();
        this.revision++;
      }
      result = { room: this.room, requests: this.room.isHost ? this.requests : this.requests.filter(request => request.displayName === 'You'), nextCursor: String(this.revision) };
    } else if (route === '/rooms/demo-room/search' && body !== undefined) {
      if (this.room.status !== 'open') throw new PartyError('This demo party is not accepting songs.');
      if (typeof input.url !== 'string') throw new PartyError('Paste a song link.');
      const link = parsePartySongLink(input.url);
      await new Promise(resolve => setTimeout(resolve, 250));
      signal?.throwIfAborted();
      if (this.scenario === 'rate_limited') throw new PartyError('Demo rate limit. Try again shortly.', 'rate_limited', 429, 2000);
      const candidates = this.scenario === 'not_found' ? [] : this.scenario === 'multiple'
        ? [tracks[0], { ...tracks[0], id: 'demo-afterglow-single', album: 'Afterglow - Single' }]
        : [tracks[0]];
      const expires = Date.now() + 5 * 60_000;
      result = { expiresAt: new Date(expires).toISOString(), candidates: candidates.map(candidate => {
        const selectionToken = crypto.randomUUID();
        this.offers.set(selectionToken, { candidate, url: link.url, expires });
        return { ...candidate, selectionToken };
      }) };
    } else if (route === '/rooms/demo-room/selections' && body !== undefined) {
      if (this.room.status !== 'open') throw new PartyError('This demo party is not accepting songs.');
      const offer = typeof input.selectionToken === 'string' && this.offers.get(input.selectionToken);
      if (!offer || offer.expires <= Date.now()) throw new PartyError('Search again and choose a sample result.');
      if (offer.id) result = { id: offer.id };
      else {
        const id = crypto.randomUUID();
        offer.id = id;
        this.requests.push({
          id, displayName: 'You', sourceUrl: offer.url, selected: offer.candidate,
          candidates: [], confidence: 'ambiguous', status: 'approved', failureCode: null,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        this.delivery.set(id, Date.now() + 1500);
        result = { id };
      }
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
