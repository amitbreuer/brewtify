import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  PartyCandidate,
  PartyConfidence,
  PartyFeed,
  PartyMode,
  PartyRequestDto,
  PartyRequestStatus,
  PartyRoomDto,
  PartyRoomStatus,
  PartyTrack,
} from '@brewtify/shared';
import { decrypt, encrypt, generateSalt } from '../services/encryption';
import { accessToken, hostFor, spotify } from './auth';
import { PartyError, telegramUrl } from './config';
import { parseSongLink } from './catalog';
import { hash, identity, secret, throttle, type MiniSession } from './security';
import { hostLock, rows, transaction } from './store';

export interface Room {
  id: string;
  owner: string;
  account_key: string;
  join_hash: string;
  encrypted_join: string;
  salt: string;
  device_id: string;
  status: PartyRoomStatus;
  mode: PartyMode;
  blocked_reason: string | null;
  expires_at: Date;
}
export interface SongRequest {
  id: string;
  room_id: string;
  participant: string;
  submission_key: string;
  display_name: string;
  source_url: string;
  source: PartyTrack | null;
  selected: PartyCandidate | null;
  confidence: PartyConfidence | null;
  status: PartyRequestStatus;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
  sequence: string;
  revision: string;
}

export function roomDto(room: Room, who: MiniSession): PartyRoomDto {
  return {
    id: room.id,
    status: room.expires_at <= new Date() ? 'expired' : room.status,
    mode: room.mode,
    expiresAt: room.expires_at.toISOString(),
    deviceId: room.owner === who.principal ? room.device_id : '',
    blockedReason: room.blocked_reason,
    isHost: room.owner === who.principal,
  };
}
export async function getRoom(id: string, client?: PoolClient): Promise<Room> {
  const [room] = await rows<Room>(
    'SELECT * FROM party_rooms WHERE id=$1',
    [id],
    client
  );
  if (!room || room.expires_at <= new Date())
    throw new PartyError(410, 'room_expired', 'This party has expired.');
  return room;
}
export function requireOwner(room: Room, who: MiniSession): void {
  if (room.owner !== who.principal)
    throw new PartyError(
      403,
      'host_required',
      'Only this party host can do that.'
    );
}
export async function requireMember(
  room: Room,
  who: MiniSession,
  client?: PoolClient
): Promise<string> {
  const participant = identity(`room:${room.id}:${who.principal}`);
  if (room.owner === who.principal) return participant;
  const [membership] = await rows(
    'SELECT participant FROM party_memberships WHERE room_id=$1 AND session_id=$2',
    [room.id, who.id],
    client
  );
  if (!membership)
    throw new PartyError(
      403,
      'invitation_required',
      'Join this party using its invitation.'
    );
  return participant;
}
export function requireLive(room: Room): void {
  if (
    room.status === 'closed' ||
    room.status === 'expired' ||
    room.expires_at <= new Date()
  ) {
    throw new PartyError(
      410,
      'room_closed',
      'This party is closed. Already queued songs remain in Spotify.'
    );
  }
}
export async function currentRoom(who: MiniSession): Promise<Room | undefined> {
  const [room] = await rows<Room>(
    `SELECT r.* FROM party_rooms r WHERE r.expires_at>now()
    AND (r.owner=$1 OR EXISTS (SELECT 1 FROM party_memberships m WHERE m.room_id=r.id AND m.session_id=$2))
    ORDER BY (r.owner=$1 AND r.status IN ('open','locked')) DESC,r.created_at DESC LIMIT 1`,
    [who.principal, who.id]
  );
  return room;
}
export async function invite(room: Room, who: MiniSession): Promise<string> {
  requireOwner(room, who);
  requireLive(room);
  return telegramUrl(`p_${decrypt(room.encrypted_join, room.salt)}`);
}
export async function devices(who: MiniSession) {
  const host = await hostFor(who.principal);
  return hostLock(host.account_key, async (client) => {
    const fresh = await hostFor(who.principal, client);
    return spotify().devices(await accessToken(fresh, client));
  });
}
export async function validateDevice(
  token: string,
  deviceId: string
): Promise<void> {
  const available = await spotify().devices(token);
  const selected = available.find((device) => device.id === deviceId);
  if (
    !selected ||
    !selected.isActive ||
    selected.isRestricted ||
    available.some((device) => device.isActive && device.id !== deviceId)
  ) {
    throw new PartyError(
      409,
      'device_confirmation_required',
      'Open Spotify, start playback on your speaker, and confirm its active unrestricted device.'
    );
  }
}
export async function createRoom(
  who: MiniSession,
  deviceId: string,
  mode: PartyMode = 'auto'
): Promise<{ room: PartyRoomDto; inviteUrl: string }> {
  const host = await hostFor(who.principal);
  return hostLock(host.account_key, async (client) => {
    const fresh = await hostFor(who.principal, client);
    await validateDevice(await accessToken(fresh, client), deviceId);
    return transaction(async (tx) => {
      await tx.query(
        'DELETE FROM party_rooms WHERE account_key=$1 AND expires_at<=now()',
        [host.account_key]
      );
      const [existing] = await rows<Room>(
        "SELECT * FROM party_rooms WHERE account_key=$1 AND status IN ('open','locked')",
        [host.account_key],
        tx
      );
      if (existing)
        throw new PartyError(
          409,
          'room_already_exists',
          'This Spotify host already has an active party.'
        );
      const join = secret();
      const salt = generateSalt();
      const [room] = await rows<Room>(
        `INSERT INTO party_rooms (id,owner,account_key,join_hash,encrypted_join,salt,device_id,mode,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '12 hours') RETURNING *`,
        [
          randomUUID(),
          who.principal,
          host.account_key,
          hash(join),
          encrypt(join, salt),
          salt,
          deviceId,
          mode,
        ],
        tx
      );
      await tx.query(
        'UPDATE party_host_sessions SET expires_at=$2 WHERE id=$1',
        [fresh.id, room.expires_at]
      );
      return { room: roomDto(room, who), inviteUrl: telegramUrl(`p_${join}`) };
    }, client);
  });
}
export async function joinRoom(
  who: MiniSession,
  join: string
): Promise<PartyRoomDto> {
  if (!/^[\w-]{43}$/.test(join))
    throw new PartyError(
      400,
      'invalid_invitation',
      'Paste a valid Party invitation.'
    );
  const [room] = await rows<Room>(
    'SELECT * FROM party_rooms WHERE join_hash=$1 AND expires_at>now()',
    [hash(join)]
  );
  if (!room)
    throw new PartyError(
      410,
      'room_expired',
      'Invitation is invalid or expired.'
    );
  requireLive(room);
  await rows(
    `INSERT INTO party_memberships (room_id,session_id,participant) VALUES ($1,$2,$3)
    ON CONFLICT DO NOTHING`,
    [room.id, who.id, identity(`room:${room.id}:${who.principal}`)]
  );
  return roomDto(room, who);
}

export async function createJob(
  client: PoolClient,
  roomId: string,
  requestId: string,
  kind: 'resolve' | 'deliver'
): Promise<void> {
  await client.query(
    `INSERT INTO party_jobs (id,room_id,request_id,kind) VALUES ($1,$2,$3,$4)
    ON CONFLICT(request_id,kind) DO UPDATE SET status='pending',generation=party_jobs.generation+1,due_at=now(),dispatched_at=NULL,failures=0`,
    [randomUUID(), roomId, requestId, kind]
  );
}
export async function submit(
  who: MiniSession,
  roomId: string,
  displayName: string,
  url: string,
  submissionKey: string
): Promise<{ id: string }> {
  const name = displayName.trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name))
    throw new PartyError(
      400,
      'invalid_name',
      'Use a display name of 1 to 40 characters.'
    );
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(submissionKey))
    throw new PartyError(
      400,
      'invalid_submission_key',
      'A unique submission key is required.'
    );
  const parsed = parseSongLink(url);
  const room = await getRoom(roomId);
  const participant = await requireMember(room, who);
  await throttle(`submit:${room.id}:${participant}`, 8, 60);
  await throttle(`submit-room:${room.id}`, 80, 60);
  return hostLock(room.account_key, (client) =>
    transaction(async (tx) => {
      const fresh = await getRoom(roomId, tx);
      requireLive(fresh);
      const [existing] = await rows<SongRequest>(
        'SELECT * FROM party_requests WHERE room_id=$1 AND participant=$2 AND submission_key=$3',
        [roomId, participant, submissionKey],
        tx
      );
      if (existing) {
        if (
          existing.source_url !== parsed.url ||
          existing.display_name !== name
        )
          throw new PartyError(
            409,
            'submission_conflict',
            'This submission key was already used.'
          );
        return { id: existing.id };
      }
      if (fresh.status !== 'open')
        throw new PartyError(
          409,
          'room_locked',
          'The host has paused new requests.'
        );
      const id = randomUUID();
      await tx.query(
        `INSERT INTO party_requests (id,room_id,participant,submission_key,display_name,source_url)
      VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, roomId, participant, submissionKey, name, parsed.url]
      );
      await createJob(tx, roomId, id, 'resolve');
      return { id };
    }, client)
  );
}

export async function feed(
  who: MiniSession,
  roomId: string,
  cursor: string
): Promise<PartyFeed> {
  const room = await getRoom(roomId);
  const participant = await requireMember(room, who);
  if (!/^\d{1,18}$/.test(cursor))
    throw new PartyError(400, 'invalid_cursor', 'Invalid request cursor.');
  const requests = await rows<SongRequest>(
    `SELECT * FROM party_requests WHERE room_id=$1 AND revision>$2
    AND ($3::boolean OR participant=$4) ORDER BY revision LIMIT 50`,
    [roomId, cursor, room.owner === who.principal, participant]
  );
  const candidates = requests.length
    ? await rows<{ request_id: string; metadata: PartyCandidate }>(
        'SELECT request_id,metadata FROM party_match_candidates WHERE request_id=ANY($1::text[])',
        [requests.map((request) => request.id)]
      )
    : [];
  const dto: PartyRequestDto[] = requests.map((request) => ({
    id: request.id,
    displayName: request.display_name,
    sourceUrl: request.source_url,
    source: request.source ?? undefined,
    selected: request.selected ?? undefined,
    candidates:
      room.owner === who.principal
        ? candidates
            .filter((candidate) => candidate.request_id === request.id)
            .map((candidate) => candidate.metadata)
        : [],
    confidence: request.confidence,
    status: request.status,
    failureCode: request.failure_code,
    createdAt: request.created_at.toISOString(),
    updatedAt: request.updated_at.toISOString(),
  }));
  return {
    room: roomDto(room, who),
    requests: dto,
    nextCursor: requests.at(-1)?.revision ?? cursor,
  };
}

export async function closeRoom(client: PoolClient, room: Room): Promise<void> {
  await client.query(
    "UPDATE party_rooms SET status='closed',encrypted_join='',blocked_reason=NULL WHERE id=$1",
    [room.id]
  );
  await client.query(
    "UPDATE party_requests SET status='rejected',failure_code='room_closed' WHERE room_id=$1 AND status IN ('pending','matched','needs_review','approved')",
    [room.id]
  );
  await client.query("UPDATE party_jobs SET status='done' WHERE room_id=$1", [
    room.id,
  ]);
  await client.query(
    'DELETE FROM party_host_sessions WHERE account_key=$1 AND principal=$2',
    [room.account_key, room.owner]
  );
  await client.query(
    "UPDATE party_authorizations SET status='failed',error='disconnected',encrypted_verifier='' WHERE principal=$1",
    [room.owner]
  );
}
export async function disconnect(who: MiniSession): Promise<void> {
  await hostLock(`principal:${who.principal}`, async () => {
    const [host] = await rows<{ account_key: string }>(
      'SELECT account_key FROM party_host_sessions WHERE principal=$1',
      [who.principal]
    );
    const [room] = await rows<Room>(
      "SELECT * FROM party_rooms WHERE owner=$1 AND status IN ('open','locked')",
      [who.principal]
    );
    await hostLock(
      host?.account_key ?? room?.account_key ?? who.principal,
      (client) =>
        transaction(async (tx) => {
          if (room) await closeRoom(tx, room);
          await tx.query('DELETE FROM party_host_sessions WHERE principal=$1', [
            who.principal,
          ]);
          await tx.query(
            "UPDATE party_authorizations SET status='failed',error='disconnected',encrypted_verifier='' WHERE principal=$1",
            [who.principal]
          );
        }, client)
    );
  });
}

export async function roomAction(
  who: MiniSession,
  id: string,
  action: string,
  options: { deviceId?: string; mode?: string }
): Promise<void> {
  const room = await getRoom(id);
  requireOwner(room, who);
  await hostLock(room.account_key, async (client) => {
    const fresh = await getRoom(id, client);
    requireLive(fresh);
    if (action === 'device') {
      if (!options.deviceId)
        throw new PartyError(
          400,
          'device_required',
          'Select an active device.'
        );
      await validateDevice(
        await accessToken(await hostFor(who.principal, client), client),
        options.deviceId
      );
    }
    await transaction(async (tx) => {
      if (action === 'close') return closeRoom(tx, fresh);
      if (action === 'lock' || action === 'unlock') {
        await tx.query('UPDATE party_rooms SET status=$2 WHERE id=$1', [
          id,
          action === 'lock' ? 'locked' : 'open',
        ]);
      } else if (action === 'mode') {
        if (options.mode !== 'host_approval' && options.mode !== 'auto')
          throw new PartyError(
            400,
            'invalid_mode',
            'Choose approval or auto-add.'
          );
        await tx.query('UPDATE party_rooms SET mode=$2 WHERE id=$1', [
          id,
          options.mode,
        ]);
      } else if (action === 'device') {
        if (fresh.blocked_reason === 'delivery_unknown')
          throw new PartyError(
            409,
            'delivery_unknown',
            'Acknowledge the uncertain queue command first.'
          );
        await tx.query(
          'UPDATE party_rooms SET device_id=$2,blocked_reason=NULL WHERE id=$1',
          [id, options.deviceId]
        );
      } else if (action === 'acknowledge_unknown') {
        const [recent] = await rows(
          `SELECT id FROM party_delivery_attempts WHERE room_id=$1 AND outcome IN ('sending','unknown')
          AND created_at>now()-interval '2 minutes' LIMIT 1`,
          [id],
          tx
        );
        if (recent)
          throw new PartyError(
            409,
            'delivery_settling',
            'Wait two minutes for the in-flight command to settle before acknowledging uncertainty.'
          );
        await tx.query(
          "UPDATE party_rooms SET blocked_reason=NULL WHERE id=$1 AND blocked_reason='delivery_unknown'",
          [id]
        );
      } else
        throw new PartyError(400, 'invalid_action', 'Unknown room action.');
      await tx.query(
        "UPDATE party_jobs SET due_at=now(),dispatched_at=NULL,generation=generation+1 WHERE room_id=$1 AND kind='deliver' AND status='pending'",
        [id]
      );
    }, client);
  });
}

export async function requestAction(
  who: MiniSession,
  roomId: string,
  requestId: string,
  action: string,
  options: { candidateId?: string; confirmDuplicateRisk?: boolean }
): Promise<void> {
  const room = await getRoom(roomId);
  requireOwner(room, who);
  await hostLock(room.account_key, (client) =>
    transaction(async (tx) => {
      const fresh = await getRoom(roomId, tx);
      requireLive(fresh);
      const [request] = await rows<SongRequest>(
        'SELECT * FROM party_requests WHERE id=$1 AND room_id=$2 FOR UPDATE',
        [requestId, roomId],
        tx
      );
      if (!request)
        throw new PartyError(404, 'request_not_found', 'Request not found.');
      if (action === 'reject') {
        if (['added', 'rejected'].includes(request.status))
          throw new PartyError(
            409,
            'invalid_transition',
            'This request cannot be removed from Spotify.'
          );
        const [sending] = await rows(
          "SELECT id FROM party_delivery_attempts WHERE request_id=$1 AND outcome='sending'",
          [requestId],
          tx
        );
        if (sending)
          throw new PartyError(
            409,
            'delivery_unknown',
            'Wait for the uncertain delivery to be reconciled.'
          );
        await tx.query(
          "UPDATE party_requests SET status='rejected' WHERE id=$1",
          [requestId]
        );
        await tx.query(
          "UPDATE party_jobs SET status='done' WHERE request_id=$1",
          [requestId]
        );
        return;
      }
      if (action === 'select') {
        if (!['needs_review', 'matched'].includes(request.status))
          throw new PartyError(
            409,
            'invalid_transition',
            'A version cannot be selected for this request.'
          );
        const [candidate] = await rows<{ metadata: PartyCandidate }>(
          'SELECT metadata FROM party_match_candidates WHERE request_id=$1 AND track_id=$2',
          [requestId, options.candidateId ?? ''],
          tx
        );
        if (!candidate)
          throw new PartyError(
            400,
            'invalid_candidate',
            'Choose one of the proposed Spotify versions.'
          );
        const status = fresh.mode === 'auto' ? 'approved' : 'matched';
        await tx.query(
          `UPDATE party_requests SET selected=$2,status=$3,
          approved_order=CASE WHEN $3='approved' THEN nextval('party_approval_order') ELSE NULL END WHERE id=$1`,
          [requestId, candidate.metadata, status]
        );
        if (status === 'approved') await createJob(tx, roomId, requestId, 'deliver');
        return;
      }
      if (action === 'retry') {
        if (request.status !== 'failed')
          throw new PartyError(
            409,
            'invalid_transition',
            'Only failed requests can be retried.'
          );
        if (
          request.failure_code === 'delivery_unknown' &&
          options.confirmDuplicateRisk !== true
        ) {
          throw new PartyError(
            409,
            'duplicate_risk_confirmation_required',
            'Spotify may already have queued this song. Explicitly confirm the duplicate risk.'
          );
        }
        if (request.failure_code === 'delivery_unknown') {
          const [recent] = await rows(
            `SELECT id FROM party_delivery_attempts WHERE request_id=$1 AND outcome='unknown'
          AND created_at>now()-interval '2 minutes' LIMIT 1`,
            [requestId],
            tx
          );
          if (recent)
            throw new PartyError(
              409,
              'delivery_settling',
              'Wait two minutes before intentionally retrying an uncertain queue command.'
            );
        }
        const [sending] = await rows(
          "SELECT id FROM party_delivery_attempts WHERE room_id=$1 AND outcome='sending'",
          [roomId],
          tx
        );
        if (sending)
          throw new PartyError(
            409,
            'delivery_unknown',
            'Wait for in-flight recovery before retrying.'
          );
        if (!request.selected || request.failure_code === 'recording_changed') {
          await tx.query(
            "UPDATE party_requests SET status='pending',selected=NULL,failure_code=$2 WHERE id=$1",
            [
              requestId,
              request.failure_code === 'recording_changed'
                ? 'recording_changed'
                : null,
            ]
          );
          await createJob(tx, roomId, requestId, 'resolve');
          return;
        }
      } else if (
        action !== 'approve' ||
        request.status !== 'matched' ||
        !request.selected
      ) {
        throw new PartyError(
          409,
          'invalid_transition',
          'Choose a Spotify version before approving this request.'
        );
      }
      await tx.query(
        "UPDATE party_requests SET status='approved',failure_code=NULL,approved_order=nextval('party_approval_order') WHERE id=$1",
        [requestId]
      );
      await createJob(tx, roomId, requestId, 'deliver');
    }, client)
  );
}
