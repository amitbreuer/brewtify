import { randomUUID } from 'node:crypto';
import type { PartyCandidate, PartyConfidence, PartySearchResult, PartyTrack } from '@brewtify/shared';
import { accessToken, hostFor, spotify } from './auth';
import { parseSongLink, resolveSong } from './catalog';
import { PartyError } from './config';
import { createJob, getRoom, requireLive, requireMember, type SongRequest } from './rooms';
import { constantEqual, identity, throttle, type MiniSession } from './security';
import { hostLock, rows, transaction } from './store';

interface Selection {
  session: string;
  room: string;
  nonce: string;
  expires: number;
  source: PartyTrack;
  candidate: PartyCandidate;
  confidence: PartyConfidence;
}

export const SELECTION_TOKEN_LIMIT = 30000;

function sign(selection: Selection): string {
  const payload = Buffer.from(JSON.stringify(selection)).toString('base64url');
  const token = `${payload}.${identity(`party-selection-v1:${payload}`)}`;
  if (token.length > SELECTION_TOKEN_LIMIT)
    throw new PartyError(503, 'catalog_metadata_too_large', 'The catalog returned too much song metadata. Try another song link.');
  return token;
}

function verify(token: string, who: MiniSession, roomId: string): Selection {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined ||
    !constantEqual(signature, identity(`party-selection-v1:${payload}`))) {
    throw new PartyError(400, 'invalid_candidate', 'Search again and choose one of your results.');
  }
  // Only server-issued, authenticated payloads reach JSON parsing.
  const selection: Selection = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (selection.session !== who.id || selection.room !== roomId)
    throw new PartyError(403, 'invalid_candidate', 'This result belongs to another session or party.');
  if (selection.expires <= Date.now())
    throw new PartyError(410, 'search_expired', 'This search expired. Search for the song again.');
  return selection;
}

export async function searchSongs(who: MiniSession, roomId: string, url: string): Promise<PartySearchResult> {
  const link = parseSongLink(url);
  const room = await getRoom(roomId);
  requireLive(room);
  const participant = await requireMember(room, who);
  await throttle(`search:${roomId}:${participant}`, 6, 60);
  await throttle(`search-room:${roomId}`, 16, 60);
  return hostLock(room.account_key, async (client) => {
    const fresh = await getRoom(roomId, client);
    requireLive(fresh);
    await requireMember(fresh, who, client);
    if (fresh.status !== 'open')
      throw new PartyError(409, 'room_locked', 'The host has paused new requests.');
    const token = await accessToken(await hostFor(fresh.owner, client), client);
    const match = await resolveSong(link.url, token, spotify());
    requireLive(await getRoom(roomId, client));
    const expires = Math.min(Date.now() + 5 * 60_000, fresh.expires_at.getTime(), who.expires_at.getTime());
    if (expires <= Date.now())
      throw new PartyError(401, 'session_expired', 'Your Party session expired. Reopen the Mini App in Telegram.');
    const nonce = randomUUID();
    return {
      expiresAt: new Date(expires).toISOString(),
      candidates: match.candidates.map(candidate => ({
        ...candidate,
        selectionToken: sign({
          session: who.id, room: roomId, nonce, expires,
          source: match.source, candidate, confidence: match.confidence,
        }),
      })),
    };
  });
}

export async function selectSong(who: MiniSession, roomId: string, token: string): Promise<{ id: string }> {
  const selection = verify(token, who, roomId);
  const room = await getRoom(roomId);
  const participant = await requireMember(room, who);
  await throttle(`select:${roomId}:${participant}`, 8, 60);
  await throttle(`select-room:${roomId}`, 80, 60);
  return hostLock(room.account_key, client => transaction(async tx => {
    const fresh = await getRoom(roomId, tx);
    requireLive(fresh);
    await requireMember(fresh, who, tx);
    verify(token, who, roomId);
    const [existing] = await rows<SongRequest>(
      'SELECT * FROM party_requests WHERE room_id=$1 AND participant=$2 AND submission_key=$3',
      [roomId, participant, selection.nonce], tx,
    );
    if (existing) {
      if (existing.source_url !== selection.source.url || existing.selected?.id !== selection.candidate.id)
        throw new PartyError(409, 'submission_conflict', 'A different result from this search was already selected.');
      return { id: existing.id };
    }
    if (fresh.status !== 'open')
      throw new PartyError(409, 'room_locked', 'The host has paused new requests.');
    const id = randomUUID();
    // Explicit submitter confirmation bypasses legacy host approval, never delivery safeguards.
    await tx.query(
      `INSERT INTO party_requests
      (id,room_id,participant,submission_key,display_name,source_url,source,selected,confidence,status,approved_order)
      VALUES ($1,$2,$3,$4,'Guest',$5,$6,$7,$8,'approved',nextval('party_approval_order'))`,
      [id, roomId, participant, selection.nonce, selection.source.url, selection.source, selection.candidate, selection.confidence],
    );
    await tx.query(
      'INSERT INTO party_match_candidates (request_id,track_id,metadata) VALUES ($1,$2,$3)',
      [id, selection.candidate.id, selection.candidate],
    );
    await createJob(tx, roomId, id, 'deliver');
    return { id };
  }, client));
}
