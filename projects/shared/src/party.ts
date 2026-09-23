export type PartyRequestStatus =
  | 'pending'
  | 'matched'
  | 'needs_review'
  | 'approved'
  | 'added'
  | 'unavailable'
  | 'rejected'
  | 'failed';
export type PartyRoomStatus = 'open' | 'locked' | 'closed' | 'expired';
export type PartyMode = 'host_approval' | 'auto';
export type PartyConfidence = 'exact' | 'high' | 'ambiguous' | 'no_match';

export interface PartyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  explicit: boolean | null;
  isrc?: string;
  url: string;
  artwork?: string;
}

export interface PartyCandidate extends PartyTrack {
  evidence: string[];
}

export interface PartySearchResult {
  candidates: (PartyCandidate & { selectionToken: string })[];
  expiresAt: string;
}

export interface PartyRequestDto {
  id: string;
  displayName: string;
  sourceUrl: string;
  source?: PartyTrack;
  selected?: PartyCandidate;
  candidates: PartyCandidate[];
  confidence: PartyConfidence | null;
  status: PartyRequestStatus;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartyRoomDto {
  id: string;
  status: PartyRoomStatus;
  mode: PartyMode;
  expiresAt: string;
  blockedReason: string | null;
  isHost: boolean;
}

export interface PartyDevice {
  id: string;
  name: string;
  isActive: boolean;
  isRestricted: boolean;
}

export interface PartySessionDto {
  csrfToken: string;
  hostConnected: boolean;
  room: PartyRoomDto | null;
}

export interface PartyFeed {
  room: PartyRoomDto;
  requests: PartyRequestDto[];
  nextCursor: string | null;
}

export interface PartyConfigDto {
  enabled: boolean;
  telegramUrl: string | null;
  autoEnabled: boolean;
}

export const PARTY_LIMITS = {
  roomHours: 12,
  displayNameLength: 40,
  urlLength: 2048,
  candidates: 10,
  pageSize: 50,
} as const;
