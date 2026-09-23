import { randomUUID } from 'node:crypto';
import { CloudTasksClient } from '@google-cloud/tasks';
import { OAuth2Client } from 'google-auth-library';
import type { PoolClient } from 'pg';
import { assertSelectedRecording, SpotifyError } from '@brewtify/spotify';
import { accessToken, hostFor, spotify } from './auth';
import { CatalogError, resolveSong } from './catalog';
import { PartyError, partyOrigin, required } from './config';
import {
  createJob,
  getRoom,
  requireLive,
  type Room,
  type SongRequest,
} from './rooms';
import { hostLock, rows, transaction } from './store';

export interface Job {
  id: string;
  room_id: string;
  request_id: string;
  kind: 'resolve' | 'deliver';
  status: 'pending' | 'done';
  generation: number;
  failures: number;
  due_at: Date;
}

const oidc = new OAuth2Client();
export async function verifyInternal(
  bearer: string | undefined
): Promise<void> {
  if (!bearer?.startsWith('Bearer '))
    throw new PartyError(
      401,
      'internal_auth_required',
      'OIDC authentication required.'
    );
  let payload;
  try {
    const ticket = await oidc.verifyIdToken({
      idToken: bearer.slice(7),
      audience: required('PARTY_TASKS_AUDIENCE'),
    });
    payload = ticket.getPayload();
  } catch {
    throw new PartyError(
      401,
      'internal_auth_invalid',
      'Invalid OIDC identity.'
    );
  }
  if (
    !payload ||
    payload.email_verified !== true ||
    payload.email !== required('PARTY_TASKS_SERVICE_ACCOUNT')
  ) {
    throw new PartyError(
      403,
      'internal_identity_rejected',
      'This service identity is not authorized.'
    );
  }
}

export async function dispatchOutbox(): Promise<number> {
  const tasks = new CloudTasksClient();
  const parent = tasks.queuePath(
    required('PARTY_TASKS_PROJECT'),
    required('PARTY_TASKS_LOCATION'),
    required('PARTY_TASKS_QUEUE')
  );
  const jobs =
    await rows<Job>(`UPDATE party_jobs SET generation=generation+1,dispatched_at=NULL
    WHERE id IN (SELECT id FROM party_jobs WHERE status='pending' AND dispatched_at<now()-interval '10 minutes' LIMIT 100) RETURNING *`);
  // Named tasks make a successful create followed by a DB/network failure safe to replay.
  const pending =
    await rows<Job>(`SELECT j.* FROM party_jobs j JOIN party_rooms r ON r.id=j.room_id
    WHERE j.status='pending' AND j.dispatched_at IS NULL AND r.expires_at>now() AND r.status IN ('open','locked')
    ORDER BY j.due_at,j.id LIMIT 25`);
  let count = 0;
  try {
    for (const job of pending) {
      try {
        await tasks.createTask(
          {
            parent,
            task: {
              name: `${parent}/tasks/party-${job.id}-${job.generation}`,
              scheduleTime: {
                seconds: Math.floor(
                  Math.max(Date.now(), job.due_at.getTime()) / 1000
                ),
              },
              dispatchDeadline: { seconds: 120 },
              httpRequest: {
                httpMethod: 'POST',
                url: `${partyOrigin()}/internal/party/jobs`,
                headers: { 'Content-Type': 'application/json' },
                body: Buffer.from(
                  JSON.stringify({ jobId: job.id, generation: job.generation })
                ).toString('base64'),
                oidcToken: {
                  serviceAccountEmail: required('PARTY_TASKS_SERVICE_ACCOUNT'),
                  audience: required('PARTY_TASKS_AUDIENCE'),
                },
              },
            },
          },
          { timeout: 5000 }
        );
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 6
        )
          throw error;
      }
      await rows(
        'UPDATE party_jobs SET dispatched_at=now() WHERE id=$1 AND generation=$2 AND status=$3',
        [job.id, job.generation, 'pending']
      );
      count++;
    }
  } finally {
    await tasks.close();
  }
  return count + jobs.length;
}

export async function reschedule(
  client: PoolClient,
  job: Job,
  seconds: number,
  failure = false
): Promise<void> {
  await client.query(
    `UPDATE party_jobs SET due_at=now()+($2 * interval '1 second'),dispatched_at=NULL,generation=generation+1,
    failures=failures+$3 WHERE id=$1 AND status='pending'`,
    [job.id, Math.max(1, seconds), failure ? 1 : 0]
  );
}
async function done(client: PoolClient, job: Job): Promise<void> {
  await client.query("UPDATE party_jobs SET status='done' WHERE id=$1", [
    job.id,
  ]);
}

export function deliveryOutcome(
  error: unknown
): 'unknown' | 'rate_limited' | 'rejected' {
  if (error instanceof SpotifyError) {
    if (error.unknownDelivery || (error.status ?? 0) >= 500) return 'unknown';
    if (error.status === 429) return 'rate_limited';
    return 'rejected';
  }
  return 'unknown';
}
function errorCode(error: unknown): string {
  return error instanceof PartyError ||
    error instanceof SpotifyError ||
    error instanceof CatalogError
    ? error.code
    : 'provider_unavailable';
}

// Obtaining the account lock with a persisted sending record means the previous owner
// never recorded an outcome. It is not evidence that the remote command was not sent.
export async function recoverSending(
  client: PoolClient,
  room: Room
): Promise<boolean> {
  return transaction(async (tx) => {
    const attempts = await rows<{ id: string; request_id: string }>(
      "UPDATE party_delivery_attempts SET outcome='unknown',updated_at=now() WHERE room_id=$1 AND outcome='sending' RETURNING *",
      [room.id],
      tx
    );
    if (!attempts.length) return false;
    await tx.query(
      "UPDATE party_rooms SET blocked_reason='delivery_unknown' WHERE id=$1",
      [room.id]
    );
    for (const attempt of attempts) {
      await tx.query(
        "UPDATE party_requests SET status='failed',failure_code='delivery_unknown' WHERE id=$1",
        [attempt.request_id]
      );
      await tx.query(
        "UPDATE party_jobs SET status='done' WHERE request_id=$1 AND kind='deliver'",
        [attempt.request_id]
      );
    }
    return true;
  }, client);
}

async function resolve(
  client: PoolClient,
  room: Room,
  job: Job,
  request: SongRequest
): Promise<void> {
  if (request.status !== 'pending') return done(client, job);
  const token = await accessToken(await hostFor(room.owner, client), client);
  const match = await resolveSong(request.source_url, token, spotify());
  await transaction(async (tx) => {
    requireLive(await getRoom(room.id, tx));
    await tx.query('DELETE FROM party_match_candidates WHERE request_id=$1', [
      request.id,
    ]);
    for (const candidate of match.candidates) {
      await tx.query(
        `INSERT INTO party_match_candidates (request_id,track_id,metadata) VALUES ($1,$2,$3)
        ON CONFLICT(request_id,track_id) DO UPDATE SET metadata=EXCLUDED.metadata`,
        [request.id, candidate.id, candidate]
      );
    }
    const auto =
      request.failure_code !== 'recording_changed' &&
      room.mode === 'auto' &&
      (match.confidence === 'exact' || match.confidence === 'high') &&
      !!match.selected;
    const status =
      match.confidence === 'no_match'
        ? 'unavailable'
        : auto
          ? 'approved'
          : match.selected
            ? 'matched'
            : 'needs_review';
    await tx.query(
      `UPDATE party_requests SET source=$2,selected=$3,confidence=$4,status=$5,failure_code=NULL,
      approved_order=CASE WHEN $5='approved' THEN nextval('party_approval_order') ELSE NULL END WHERE id=$1`,
      [
        request.id,
        match.source,
        match.selected ?? null,
        match.confidence,
        status,
      ]
    );
    if (auto) await createJob(tx, room.id, request.id, 'deliver');
    await done(tx, job);
  }, client);
}

async function deliver(
  client: PoolClient,
  room: Room,
  job: Job,
  request: SongRequest
): Promise<void> {
  if (request.status !== 'approved' || !request.selected)
    return done(client, job);
  if (room.blocked_reason) return reschedule(client, job, 60);
  const [first] = await rows<{ id: string }>(
    `SELECT id FROM party_requests WHERE room_id=$1 AND status='approved'
    ORDER BY CASE WHEN $2='auto' THEN sequence ELSE approved_order END,sequence LIMIT 1`,
    [room.id, room.mode],
    client
  );
  if (first?.id !== request.id) return reschedule(client, job, 5);
  const token = await accessToken(await hostFor(room.owner, client), client);
  const track = await spotify().track(token, request.selected.id);
  assertSelectedRecording(track, request.selected);
  const attempt = randomUUID();
  await transaction(async (tx) => {
    requireLive(await getRoom(room.id, tx));
    await tx.query(
      'INSERT INTO party_delivery_attempts (id,room_id,request_id) VALUES ($1,$2,$3)',
      [attempt, room.id, request.id]
    );
  }, client);
  // Nothing before this commit can have sent a queue command. Nothing after it is
  // automatically retryable unless Spotify explicitly rejects the command.
  try {
    await spotify().enqueue(token, request.selected.id);
  } catch (error) {
    const outcome = deliveryOutcome(error);
    await transaction(async (tx) => {
      const [recorded] = await rows(
        `UPDATE party_delivery_attempts SET outcome=$2,updated_at=now()
        WHERE id=$1 AND outcome='sending' RETURNING id`,
        [attempt, outcome === 'unknown' ? 'unknown' : 'rejected'],
        tx
      );
      if (!recorded) return;
      if (outcome === 'rate_limited') {
        await tx.query(
          "UPDATE party_requests SET failure_code='rate_limited' WHERE id=$1",
          [request.id]
        );
        await reschedule(
          tx,
          job,
          error instanceof SpotifyError ? (error.retryAfterSeconds ?? 60) : 60
        );
      } else {
        const code =
          outcome === 'unknown' ? 'delivery_unknown' : errorCode(error);
        await tx.query(
          "UPDATE party_requests SET status='failed',failure_code=$2 WHERE id=$1",
          [request.id, code]
        );
        if (
          outcome === 'unknown' ||
          (error instanceof SpotifyError &&
            [401, 403, 404].includes(error.status ?? 0))
        ) {
          await tx.query(
            'UPDATE party_rooms SET blocked_reason=$2 WHERE id=$1',
            [room.id, code]
          );
        }
        await done(tx, job);
      }
    }, client);
    return;
  }
  await transaction(async (tx) => {
    const [recorded] = await rows(
      "UPDATE party_delivery_attempts SET outcome='accepted',updated_at=now() WHERE id=$1 AND outcome='sending' RETURNING id",
      [attempt],
      tx
    );
    if (!recorded) return;
    await tx.query(
      "UPDATE party_requests SET status='added',failure_code=NULL WHERE id=$1",
      [request.id]
    );
    await done(tx, job);
  }, client);
}

export async function runJob(id: string, generation: number): Promise<void> {
  const [original] = await rows<Job>('SELECT * FROM party_jobs WHERE id=$1', [
    id,
  ]);
  if (
    !original ||
    original.status === 'done' ||
    original.generation !== generation
  )
    return;
  const [room] = await rows<Room>('SELECT * FROM party_rooms WHERE id=$1', [
    original.room_id,
  ]);
  if (!room) return;
  await hostLock(room.account_key, async (client) => {
    await recoverSending(client, room);
    const [job] = await rows<Job>(
      'SELECT * FROM party_jobs WHERE id=$1',
      [id],
      client
    );
    if (!job || job.status === 'done' || job.generation !== generation) return;
    if (job.due_at > new Date())
      throw new PartyError(429, 'task_not_due', 'Task is not due.', 5);
    const [request] = await rows<SongRequest>(
      'SELECT * FROM party_requests WHERE id=$1',
      [job.request_id],
      client
    );
    if (!request) return done(client, job);
    try {
      const fresh = await getRoom(room.id, client);
      requireLive(fresh);
      if (job.kind === 'resolve') await resolve(client, fresh, job, request);
      else await deliver(client, fresh, job, request);
    } catch (error) {
      // DB failure after sending must leave the durable marker for reconciliation.
      const [sending] = await rows(
        "SELECT id FROM party_delivery_attempts WHERE room_id=$1 AND outcome='sending'",
        [room.id],
        client
      );
      if (sending) throw error;
      const code = errorCode(error);
      if (error instanceof PartyError && error.status === 410)
        return done(client, job);
      await transaction(async (tx) => {
        if (
          (error instanceof SpotifyError || error instanceof CatalogError) &&
          error.status === 429
        ) {
          await tx.query(
            'UPDATE party_requests SET failure_code=$2 WHERE id=$1',
            [request.id, code]
          );
          await reschedule(tx, job, error.retryAfterSeconds ?? 60);
        } else if (code === 'recording_changed') {
          await tx.query(
            "UPDATE party_requests SET status='failed',failure_code=$2 WHERE id=$1",
            [request.id, code]
          );
          await done(tx, job);
        } else if (code === 'track_unavailable') {
          await tx.query(
            "UPDATE party_requests SET status='unavailable',failure_code=$2 WHERE id=$1",
            [request.id, code]
          );
          await done(tx, job);
        } else if (
          (error instanceof PartyError &&
            code === 'host_reconnect') ||
          (error instanceof SpotifyError &&
            [401, 403].includes(error.status ?? 0))
        ) {
          await tx.query(
            'UPDATE party_rooms SET blocked_reason=$2 WHERE id=$1',
            [room.id, code]
          );
          await tx.query(
            'UPDATE party_requests SET failure_code=$2 WHERE id=$1',
            [request.id, code]
          );
          await reschedule(tx, job, 60);
        } else if (
          job.failures < 4 &&
          (!(error instanceof PartyError) || error.status >= 500)
        ) {
          await reschedule(
            tx,
            job,
            Math.min(120, 5 * 2 ** job.failures) +
              Math.floor(Math.random() * 5),
            true
          );
        } else {
          await tx.query(
            "UPDATE party_requests SET status='failed',failure_code=$2 WHERE id=$1",
            [request.id, code]
          );
          await done(tx, job);
        }
      }, client);
    }
  });
}

export async function cleanup(): Promise<number> {
  const expired = await rows<Room>(
    'SELECT * FROM party_rooms WHERE expires_at<=now() ORDER BY expires_at LIMIT 100'
  );
  let count = 0;
  for (const room of expired) {
    try {
      await hostLock(room.account_key, (client) =>
        transaction(async (tx) => {
          await tx.query(
            'DELETE FROM party_host_sessions WHERE account_key=$1 AND expires_at<=now()',
            [room.account_key]
          );
          await tx.query(
            'DELETE FROM party_rooms WHERE id=$1 AND expires_at<=now()',
            [room.id]
          );
        }, client)
      );
      count++;
    } catch (error) {
      if (!(error instanceof PartyError && error.code === 'host_busy'))
        throw error;
    }
  }
  for (const table of [
    'party_authorizations',
    'party_mini_app_sessions',
    'party_throttles',
    'party_host_sessions',
  ]) {
    const key = table === 'party_throttles' ? 'key' : 'id';
    await rows(
      `DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE expires_at<=now() LIMIT 500)`
    );
  }
  const abandoned =
    await rows<Room>(`SELECT DISTINCT r.* FROM party_rooms r JOIN party_delivery_attempts a ON a.room_id=r.id
    WHERE a.outcome='sending' AND a.created_at<now()-interval '2 minutes' LIMIT 100`);
  for (const room of abandoned) {
    try {
      await hostLock(room.account_key, (client) =>
        recoverSending(client, room)
      );
    } catch (error) {
      if (!(error instanceof PartyError && error.code === 'host_busy'))
        throw error;
    }
  }
  return count;
}
