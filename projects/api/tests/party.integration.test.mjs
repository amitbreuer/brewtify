import { after, before, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const express = require('express');
const { SpotifyClient, SpotifyError } = require('@brewtify/spotify');
const spotifyTrack = SpotifyClient.prototype.track;
const spotifyEnqueue = SpotifyClient.prototype.enqueue;
const origin = 'https://party.test';
Object.assign(process.env, {
  PARTY_ENABLED: 'true',
  PARTY_PUBLIC_ORIGIN: origin,
  PARTY_TELEGRAM_BOT_USERNAME: 'test_party_bot',
  PARTY_IDENTITY_KEY: 'ab'.repeat(32),
  ENCRYPTION_KEY: 'cd'.repeat(32),
  TELEGRAM_BOT_TOKEN: '123456:test',
  SPOTIFY_CLIENT_ID: 'test-client',
  PARTY_SPOTIFY_REDIRECT_URI: `${origin}/api/party/auth/callback`,
  PARTY_TASKS_PROJECT: 'test',
  PARTY_TASKS_LOCATION: 'test',
  PARTY_TASKS_QUEUE: 'test',
  PARTY_TASKS_SERVICE_ACCOUNT: 'tasks@test.invalid',
  PARTY_TASKS_AUDIENCE: origin,
});
let pg, server, base, store, jobs;
let queueCalls = 0;
let queueFailure;
const trackId = '0123456789ABCDEFGHIJKL';
const scopes = ['user-modify-playback-state'];
const tokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 3600,
  scopes,
};
const track = {
  id: trackId,
  name: 'Test Song',
  title: 'Test Song',
  artist: 'Artist',
  album: { name: 'Album', images: [] },
  artists: [{ name: 'Artist' }],
  duration_ms: 180000,
  explicit: false,
  is_playable: true,
  external_ids: { isrc: 'USABC2400001' },
  external_urls: { spotify: `https://open.spotify.com/track/${trackId}` },
};
async function freePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
before(async () => {
  const port = await freePort();
  const dir = path.resolve('.data', `party-test-${randomUUID()}`);
  await mkdir(path.dirname(dir), { recursive: true });
  pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'party_test',
    password: 'local-test-only',
    port,
    persistent: false,
    createPostgresUser: false,
    postgresFlags: ['-h', '127.0.0.1'],
    onLog() {},
    onError(message) {
      if (/FATAL|ERROR/.test(String(message))) console.error(message);
    },
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('party_test');
  process.env.DATABASE_URL = `postgresql://party_test:local-test-only@127.0.0.1:${port}/party_test`;
  store = require('../dist/party/store.js');
  const prismaCli = path.join(
    path.dirname(require.resolve('prisma/package.json')),
    'build/index.js'
  );
  await promisify(execFile)(
    process.execPath,
    [prismaCli, 'migrate', 'deploy'],
    { env: process.env }
  );
  await promisify(execFile)(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    { env: process.env }
  );
  mock.method(SpotifyClient.prototype, 'profile', async () => ({
    id: 'previously-unlisted-spotify',
  }));
  mock.method(SpotifyClient.prototype, 'exchange', async () => tokens);
  mock.method(SpotifyClient.prototype, 'refresh', async () => ({
    ...tokens,
    accessToken: 'rotated',
    refreshToken: 'rotated-refresh',
  }));
  mock.method(SpotifyClient.prototype, 'devices', async () => { assert.fail('Party must not discover or select devices'); });
  mock.method(SpotifyClient.prototype, 'track', async () => track);
  mock.method(SpotifyClient.prototype, 'enqueue', async (_token, _track, deviceId) => {
    assert.equal(deviceId, undefined, 'Spotify targets the host account active playback');
    queueCalls++;
    if (queueFailure) throw queueFailure;
  });
  const {
    partyRoutes,
    internalPartyRoutes,
  } = require('../dist/party/routes.js');
  jobs = require('../dist/party/jobs.js');
  const app = express();
  app.use('/api/party', partyRoutes);
  app.use('/internal/party', internalPartyRoutes);
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  mock.restoreAll();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (store) await store.database().end();
  if (pg) await pg.stop();
});
function signed(id, extra = {}) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id }),
    query_id: randomUUID(),
    ...extra,
  };
  const data = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData')
    .update(process.env.TELEGRAM_BOT_TOKEN)
    .digest();
  return new URLSearchParams({
    ...fields,
    hash: createHmac('sha256', key).update(data).digest('hex'),
  }).toString();
}
async function call(route, user, body, extra = {}) {
  const response = await fetch(`${base}/api/party${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(user ? { Cookie: user.cookie, 'X-Party-CSRF': user.csrf } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { response, data };
}
async function guest(id) {
  const launch = signed(id);
  const { response, data } = await call('/session', null, { initData: launch });
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.match(
    response.headers.get('set-cookie'),
    /HttpOnly; Secure; SameSite=Lax/
  );
  return {
    cookie: response.headers.get('set-cookie').split(';')[0],
    csrf: data.csrfToken,
    launch,
  };
}
async function authorize(user) {
  const start = await call('/auth/start', user, { premiumConfirmed: true });
  assert.equal(start.response.status, 200, JSON.stringify(start.data));
  const link = new URL(start.data.authorizationUrl);
  const launch = await call(
    `${link.pathname.replace('/api/party', '')}${link.search}`,
    null
  );
  assert.equal(launch.response.status, 302);
  const oauth = new URL(launch.response.headers.get('location'));
  assert.equal(oauth.searchParams.get('scope'), scopes.join(' '));
  const state = oauth.searchParams.get('state');
  const browserCookie = launch.response.headers.get('set-cookie').split(';')[0];
  const result = await call(
    `/auth/callback?state=${state}&code=test`,
    null,
    undefined,
    { Cookie: browserCookie }
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal((await call('/auth/status', user)).data.status, 'complete');
  return { state, browserCookie };
}
async function makeRoom(user) {
  const result = await call('/rooms', user, {
    mode: 'host_approval',
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return result.data;
}
async function runPending(requestId, kind) {
  const [job] = await store.rows(
    'SELECT * FROM party_jobs WHERE request_id=$1 AND kind=$2',
    [requestId, kind]
  );
  assert.ok(job);
  await jobs.runJob(job.id, job.generation);
}
async function song(user, roomId) {
  const result = await call(`/rooms/${roomId}/requests`, user, {
    displayName: 'Guest',
    url: `https://open.spotify.com/track/${trackId}`,
    submissionKey: randomUUID(),
  });
  assert.equal(result.response.status, 202, JSON.stringify(result.data));
  return result.data.id;
}
let host, member, outsider, room, invitation;
test('signed sessions reject raw IDs, origin forgery, tampering and launch replay', async () => {
  assert.equal(
    (await call('/session', null, {}, { 'X-Telegram-User-Id': '123' })).response
      .status,
    401
  );
  assert.equal(
    (
      await call(
        '/session',
        null,
        { initData: signed(123) },
        { Origin: 'https://evil.test' }
      )
    ).response.status,
    403
  );
  host = await guest(100);
  member = await guest(200);
  outsider = await guest(300);
  assert.equal(
    (await call('/session', null, { initData: host.launch })).data.error.code,
    'launch_replayed'
  );
  const reordered = new URLSearchParams(
    [...new URLSearchParams(host.launch)].reverse()
  ).toString();
  assert.equal(
    (await call('/session', null, { initData: reordered })).data.error.code,
    'launch_replayed'
  );
  assert.equal(
    (await call('/session', host, { initData: host.launch })).response.status,
    200
  );
  assert.equal(
    (
      await call(
        '/auth/start',
        host,
        { premiumConfirmed: true },
        { 'X-Party-CSRF': 'wrong' }
      )
    ).response.status,
    403
  );
  assert.equal(
    (await call('/auth/start', host, {})).data.error.code,
    'premium_confirmation_required'
  );
  assert.equal(
    (await store.rows('SELECT * FROM users')).length,
    0,
    'Party must not create persistent Library users'
  );
  assert.equal(
    (
      await store.rows(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL'
      )
    ).length,
    4
  );
});
test('OAuth browser state mismatch, cancellation, expiration and one-use tickets', async () => {
  const start = await call('/auth/start', outsider, { premiumConfirmed: true });
  const link = new URL(start.data.authorizationUrl);
  const route = `${link.pathname.replace('/api/party', '')}${link.search}`;
  const launched = await call(route);
  assert.equal((await call(route)).response.status, 400);
  const state = new URL(
    launched.response.headers.get('location')
  ).searchParams.get('state');
  const browserCookie = launched.response.headers
    .get('set-cookie')
    .split(';')[0];
  assert.equal(
    (await call(`/auth/callback?state=${state}&code=test`, host)).response
      .status,
    400
  );
  assert.equal(
    (
      await call(
        `/auth/callback?state=${state}&error=access_denied`,
        null,
        undefined,
        { Cookie: browserCookie }
      )
    ).response.status,
    400
  );
  assert.equal(
    (await call('/auth/status', outsider)).data.error,
    'authorization_cancelled'
  );
  const next = await call('/auth/start', outsider, { premiumConfirmed: true });
  const nextLink = new URL(next.data.authorizationUrl);
  await store.rows(
    "UPDATE party_authorizations SET expires_at=now()-interval '1 second' WHERE status='pending'"
  );
  assert.equal(
    (
      await call(
        `${nextLink.pathname.replace('/api/party', '')}${nextLink.search}`
      )
    ).response.status,
    400
  );
});
test('OAuth still rejects missing playback permission and refresh credentials', async () => {
  for (const [response, expected] of [
    [{ ...tokens, scopes: [] }, 'insufficient_scope'],
    [{ ...tokens, refreshToken: undefined }, 'provider_response'],
  ]) {
    SpotifyClient.prototype.exchange.mock.mockImplementationOnce(async () => response);
    const start = await call('/auth/start', outsider, { premiumConfirmed: true });
    assert.equal(start.response.status, 200);
    const link = new URL(start.data.authorizationUrl);
    const launched = await call(`${link.pathname.replace('/api/party', '')}${link.search}`);
    assert.equal(launched.response.status, 302);
    const state = new URL(launched.response.headers.get('location')).searchParams.get('state');
    const browserCookie = launched.response.headers.get('set-cookie').split(';')[0];
    const finish = await call(`/auth/callback?state=${state}&code=test`, null, undefined, {
      Cookie: browserCookie,
    });
    assert.equal(finish.data.error.code, expected);
    assert.equal((await call('/auth/status', outsider)).data.status, 'failed');
    assert.equal((await call('/session', outsider)).data.hostConnected, false);
    assert.equal((await store.rows('SELECT * FROM party_host_sessions')).length, 0);
  }
});
test('previously unlisted Spotify account completes browser PKCE and host setup without a host list; callback replay denied', async () => {
  const { state, browserCookie } = await authorize(host);
  const { identity } = require('../dist/party/security.js');
  const [stored] = await store.rows('SELECT * FROM party_host_sessions');
  assert.equal(stored.account_key, identity('spotify:previously-unlisted-spotify'));
  assert.deepEqual(stored.scopes, scopes);
  assert.notEqual(stored.encrypted_access_token, tokens.accessToken);
  assert.notEqual(stored.encrypted_refresh_token, tokens.refreshToken);
  assert.equal((await call('/session', host)).data.hostConnected, true);
  assert.equal((await call('/auth/status', outsider)).data.status, 'failed');
  assert.equal((await call('/session', outsider)).data.hostConnected, false);
  assert.equal(
    (
      await call(`/auth/callback?state=${state}&code=test`, null, undefined, {
        Cookie: browserCookie,
      })
    ).response.status,
    400
  );
  assert.equal(queueCalls, 0, 'setup must not enqueue a Premium probe');
  ({ room, inviteUrl: invitation } = await makeRoom(host));
  assert.ok(new Date(room.expiresAt).getTime() <= Date.now() + 12 * 3600_000);
  assert.equal(
    (await call('/rooms', host, {})).data.room.id,
    room.id,
    'creation retries must resume the existing host room'
  );
  const secret = new URL(invitation).searchParams.get('startapp').slice(2);
  assert.equal((await call('/join', member, { secret })).response.status, 200);
  assert.equal(
    (await call(`/rooms/${room.id}/requests`, outsider)).response.status,
    403
  );
  assert.equal(
    (await call(`/rooms/${room.id}/action`, member, { action: 'close' }))
      .response.status,
    403
  );
  assert.equal(
    (await call(`/rooms/${room.id}/invite`, member)).response.status,
    403
  );
});
test('same Spotify account cannot be claimed by another Telegram principal', async () => {
  const start = await call('/auth/start', member, { premiumConfirmed: true });
  const link = new URL(start.data.authorizationUrl);
  const launched = await call(
    `${link.pathname.replace('/api/party', '')}${link.search}`
  );
  const state = new URL(
    launched.response.headers.get('location')
  ).searchParams.get('state');
  const cookie = launched.response.headers.get('set-cookie').split(';')[0];
  const finish = await call(
    `/auth/callback?state=${state}&code=test`,
    null,
    undefined,
    { Cookie: cookie }
  );
  assert.equal(finish.data.error.code, 'account_in_use');
  assert.equal((await call('/session', member)).data.hostConnected, false);
  const returningHost = await guest(100);
  assert.equal((await call('/session', returningHost)).data.room.id, room.id);
  assert.equal((await call('/session', returningHost)).data.room.isHost, true);
});
test('refresh is serialized, preserves rotation, and never overwrites Library credentials', async () => {
  const { decrypt } = require('../dist/services/encryption.js');
  const { accessToken, hostFor } = require('../dist/party/auth.js');
  await store.rows(
    "UPDATE party_host_sessions SET token_expires_at=now()-interval '1 second'"
  );
  const [owner] = await store.rows('SELECT principal,account_key FROM party_host_sessions');
  const readToken = () => store.hostLock(owner.account_key, async client => accessToken(await hostFor(owner.principal, client), client));
  assert.equal(await readToken(), 'rotated');
  assert.equal(await readToken(), 'rotated');
  assert.equal(SpotifyClient.prototype.refresh.mock.callCount(), 1);
  const [stored] = await store.rows('SELECT * FROM party_host_sessions');
  assert.equal(
    decrypt(stored.encrypted_refresh_token, stored.salt),
    'rotated-refresh'
  );
  assert.equal((await store.rows('SELECT * FROM users')).length, 0);
});
test('idempotent submission, own receipts, approval and successful queue acceptance', async () => {
  assert.equal(
    (
      await call(`/rooms/${room.id}/requests`, host, {
        displayName: 'Host',
        url: 'https://evil.test/song',
        submissionKey: randomUUID(),
      })
    ).response.status,
    400
  );
  const key = randomUUID();
  const body = {
    displayName: 'Guest',
    url: `https://open.spotify.com/track/${trackId}`,
    submissionKey: key,
  };
  const first = await call(`/rooms/${room.id}/requests`, member, body);
  const repeated = await call(`/rooms/${room.id}/requests`, member, body);
  assert.equal(first.data.id, repeated.data.id);
  assert.equal(
    (
      await call(`/rooms/${room.id}/requests`, member, {
        ...body,
        displayName: 'Changed',
      })
    ).response.status,
    409
  );
  const id = first.data.id;
  await runPending(id, 'resolve');
  let receipt = (
    await call(`/rooms/${room.id}/requests`, member)
  ).data.requests.find((r) => r.id === id);
  assert.equal(receipt.status, 'matched');
  assert.equal(queueCalls, 0);
  assert.equal(
    (
      await call(`/rooms/${room.id}/requests/${id}/action`, host, {
        action: 'approve',
      })
    ).response.status,
    200
  );
  const [job] = await store.rows(
    "SELECT * FROM party_jobs WHERE request_id=$1 AND kind='deliver'",
    [id]
  );
  await jobs.runJob(job.id, job.generation);
  await jobs.runJob(job.id, job.generation);
  receipt = (
    await call(`/rooms/${room.id}/requests`, member)
  ).data.requests.find((r) => r.id === id);
  assert.equal(receipt.status, 'added');
  assert.equal(queueCalls, 1, 'task redelivery must not repeat the command');
  const hostRequest = await song(host, room.id);
  const guestFeed = (await call(`/rooms/${room.id}/requests`, member)).data;
  assert.ok(!guestFeed.requests.some((r) => r.id === hostRequest));
  assert.equal('deviceId' in guestFeed.room, false);
});
test('outbox creation failures stay recoverable and named-task replay is idempotent', async () => {
  const { CloudTasksClient } = require('@google-cloud/tasks');
  const names = [];
  const create = mock.method(
    CloudTasksClient.prototype,
    'createTask',
    async (request) => {
      names.push(request.task.name);
      const body = JSON.parse(
        Buffer.from(request.task.httpRequest.body, 'base64').toString()
      );
      assert.ok(body.jobId);
      assert.equal(request.task.httpRequest.oidcToken.audience, origin);
      assert.equal(
        request.task.httpRequest.oidcToken.serviceAccountEmail,
        'tasks@test.invalid'
      );
      throw new Error('simulated task service outage');
    }
  );
  const close = mock.method(
    CloudTasksClient.prototype,
    'close',
    async () => {}
  );
  try {
    await assert.rejects(jobs.dispatchOutbox(), /simulated/);
    assert.ok(
      (
        await store.rows(
          "SELECT * FROM party_jobs WHERE status='pending' AND dispatched_at IS NULL"
        )
      ).length
    );
    create.mock.mockImplementation(async (request) => {
      names.push(request.task.name);
      const duplicate = new Error('Already exists');
      duplicate.code = 6;
      throw duplicate;
    });
    await jobs.dispatchOutbox();
    assert.equal(names[0], names[1], 'create retry uses identical task name');
    assert.ok(
      (
        await store.rows(
          "SELECT * FROM party_jobs WHERE status='pending' AND dispatched_at IS NOT NULL"
        )
      ).length
    );
  } finally {
    create.mock.restore();
    close.mock.restore();
  }
});
test('locked accepts moderation; unavailable playback requires explicit resume without device discovery', async () => {
  const id = await song(member, room.id);
  await runPending(id, 'resolve');
  await call(`/rooms/${room.id}/action`, host, { action: 'lock' });
  const blocked = await call(`/rooms/${room.id}/requests`, host, {
    displayName: 'Host',
    url: `https://open.spotify.com/track/${trackId}`,
    submissionKey: randomUUID(),
  });
  assert.equal(blocked.data.error.code, 'room_locked');
  await call(`/rooms/${room.id}/requests/${id}/action`, host, {
    action: 'approve',
  });
  queueFailure = new SpotifyError('device_unavailable', 404);
  const before = queueCalls;
  await runPending(id, 'deliver');
  assert.equal(queueCalls, before + 1);
  assert.equal(
    (await call(`/rooms/${room.id}/requests`, host)).data.room.blockedReason,
    'device_unavailable'
  );
  await runPending(id, 'deliver');
  assert.equal(queueCalls, before + 1);
  assert.equal((await call(`/rooms/${room.id}/action`, member, { action: 'resume_playback' })).response.status, 403);
  queueFailure = undefined;
  assert.equal((await call(`/rooms/${room.id}/action`, host, { action: 'resume_playback' })).response.status, 200);
  await runPending(id, 'deliver');
  await runPending(id, 'deliver');
  assert.equal(queueCalls, before + 2);
  assert.equal(SpotifyClient.prototype.devices.mock.callCount(), 0);
  await call(`/rooms/${room.id}/action`, host, { action: 'unlock' });
});
test('429 rejection persists retry timing; timeout never automatically repeats', async () => {
  const id = await song(host, room.id);
  await runPending(id, 'resolve');
  await call(`/rooms/${room.id}/requests/${id}/action`, host, {
    action: 'approve',
  });
  queueFailure = new SpotifyError('rate_limited', 429, 75);
  const before = queueCalls;
  await runPending(id, 'deliver');
  let [job] = await store.rows(
    "SELECT * FROM party_jobs WHERE request_id=$1 AND kind='deliver'",
    [id]
  );
  assert.ok(job.due_at.getTime() > Date.now() + 70000);
  await assert.rejects(jobs.runJob(job.id, job.generation));
  assert.equal(queueCalls, before + 1);
  await store.rows('UPDATE party_jobs SET due_at=now() WHERE id=$1', [job.id]);
  queueFailure = new SpotifyError(
    'provider_unavailable',
    undefined,
    undefined,
    true
  );
  await runPending(id, 'deliver');
  queueFailure = undefined;
  const receipt = (
    await call(`/rooms/${room.id}/requests`, host)
  ).data.requests.find((r) => r.id === id);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.failureCode, 'delivery_unknown');
  assert.equal((await call(`/rooms/${room.id}/action`, host, { action: 'resume_playback' })).response.status, 409);
  await runPending(id, 'deliver');
  assert.equal(queueCalls, before + 2);
  assert.equal(
    (
      await call(`/rooms/${room.id}/requests/${id}/action`, host, {
        action: 'retry',
      })
    ).data.error.code,
    'duplicate_risk_confirmation_required'
  );
  assert.equal(
    (
      await call(`/rooms/${room.id}/action`, host, {
        action: 'acknowledge_unknown',
      })
    ).data.error.code,
    'delivery_settling'
  );
  await store.rows(
    "UPDATE party_delivery_attempts SET created_at=now()-interval '3 minutes' WHERE request_id=$1",
    [id]
  );
  assert.equal(
    (
      await call(`/rooms/${room.id}/action`, host, {
        action: 'acknowledge_unknown',
      })
    ).response.status,
    200
  );
});
test('crash marker becomes unknown, not a fresh delivery; stale tasks are fenced', async () => {
  const id = await song(host, room.id);
  await runPending(id, 'resolve');
  await call(`/rooms/${room.id}/requests/${id}/action`, host, {
    action: 'approve',
  });
  await store.rows(
    'INSERT INTO party_delivery_attempts(id,room_id,request_id) VALUES($1,$2,$3)',
    [randomUUID(), room.id, id]
  );
  const before = queueCalls;
  await runPending(id, 'deliver');
  assert.equal(queueCalls, before);
  const [receipt] = await store.rows(
    'SELECT * FROM party_requests WHERE id=$1',
    [id]
  );
  assert.equal(receipt.failure_code, 'delivery_unknown');
  assert.equal(
    (await call(`/rooms/${room.id}/requests`, host)).data.room.blockedReason,
    'delivery_unknown'
  );
});
test('PostgreSQL locks exclude another process and release after connection death', async () => {
  const script = `const {hostLock}=require('./dist/party/store.js'); hostLock('cross-process',async()=>{console.log('LOCKED'); await new Promise(()=>{});});`;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', (data) =>
        String(data).includes('LOCKED')
          ? resolve()
          : reject(new Error(String(data)))
      );
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`child exited ${code}`)));
    });
    await assert.rejects(
      store.hostLock('cross-process', async () => {}),
      { code: 'host_busy' }
    );
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await store.hostLock('cross-process', async () => {});
});
test('OIDC audience and verified configured identity are mandatory', async () => {
  const { OAuth2Client } = require('google-auth-library');
  const verify = mock.method(
    OAuth2Client.prototype,
    'verifyIdToken',
    async (options) => {
      assert.equal(options.audience, origin);
      return {
        getPayload: () => ({
          email: 'attacker@test.invalid',
          email_verified: true,
        }),
      };
    }
  );
  try {
    await assert.rejects(jobs.verifyInternal('Bearer fake'), {
      code: 'internal_identity_rejected',
    });
    verify.mock.mockImplementation(async () => ({
      getPayload: () => ({
        email: 'tasks@test.invalid',
        email_verified: false,
      }),
    }));
    await assert.rejects(jobs.verifyInternal('Bearer fake'), {
      code: 'internal_identity_rejected',
    });
    verify.mock.mockImplementation(async () => ({
      getPayload: () => ({ email: 'tasks@test.invalid', email_verified: true }),
    }));
    await jobs.verifyInternal('Bearer verified-fixture');
  } finally {
    verify.mock.restore();
  }
});
test('auto mode still requires fresh recording confirmation after metadata drift', async () => {
  await store.rows(
    "UPDATE party_delivery_attempts SET created_at=now()-interval '3 minutes' WHERE outcome='unknown'"
  );
  await call(`/rooms/${room.id}/action`, host, {
    action: 'acknowledge_unknown',
  });
  assert.equal(
    (
      await call(`/rooms/${room.id}/action`, host, {
        action: 'mode',
        mode: 'auto',
      })
    ).response.status,
    200
  );
  const id = await song(host, room.id);
  await runPending(id, 'resolve');
  let [receipt] = await store.rows('SELECT * FROM party_requests WHERE id=$1', [
    id,
  ]);
  assert.equal(receipt.status, 'approved');
  const original = track.name;
  const before = queueCalls;
  try {
    track.name = 'Test Song - Remastered';
    await runPending(id, 'deliver');
    [receipt] = await store.rows('SELECT * FROM party_requests WHERE id=$1', [
      id,
    ]);
    assert.equal(receipt.failure_code, 'recording_changed');
    assert.equal(queueCalls, before);
    assert.equal(
      (
        await call(`/rooms/${room.id}/requests/${id}/action`, host, {
          action: 'retry',
        })
      ).response.status,
      200
    );
    await runPending(id, 'resolve');
    [receipt] = await store.rows('SELECT * FROM party_requests WHERE id=$1', [
      id,
    ]);
    assert.equal(
      receipt.status,
      'matched',
      're-resolved recording cannot auto-enqueue after metadata changed'
    );
    await call(`/rooms/${room.id}/requests/${id}/action`, host, {
      action: 'approve',
    });
    await runPending(id, 'deliver');
    assert.equal(queueCalls, before + 1);
  } finally {
    track.name = original;
    await call(`/rooms/${room.id}/action`, host, {
      action: 'mode',
      mode: 'host_approval',
    });
  }
});
test('close races do not interrupt or repeat an already in-flight command', async () => {
  await store.rows(
    "UPDATE party_delivery_attempts SET created_at=now()-interval '3 minutes' WHERE outcome='unknown'"
  );
  await call(`/rooms/${room.id}/action`, host, {
    action: 'acknowledge_unknown',
  });
  const id = await song(host, room.id);
  await runPending(id, 'resolve');
  await call(`/rooms/${room.id}/requests/${id}/action`, host, {
    action: 'approve',
  });
  let release;
  let started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  SpotifyClient.prototype.enqueue.mock.mockImplementation(async () => {
    queueCalls++;
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
  });
  const running = runPending(id, 'deliver');
  await entered;
  try {
    assert.equal(
      (await call(`/rooms/${room.id}/action`, host, { action: 'close' })).data
        .error.code,
      'host_busy'
    );
    const [attempt] = await store.rows(
      'SELECT * FROM party_delivery_attempts WHERE request_id=$1',
      [id]
    );
    assert.equal(attempt.outcome, 'sending');
  } finally {
    release();
    await running;
  }
  const [receipt] = await store.rows(
    'SELECT * FROM party_requests WHERE id=$1',
    [id]
  );
  assert.equal(receipt.status, 'added');
});
test('closing deletes credentials, cancels outbox and expiry cascades retained history', async () => {
  const response = await call(`/rooms/${room.id}/action`, host, {
    action: 'close',
  });
  assert.equal(response.response.status, 200, JSON.stringify(response.data));
  assert.equal(
    (await store.rows('SELECT * FROM party_host_sessions')).length,
    0
  );
  assert.equal(
    (await store.rows("SELECT * FROM party_jobs WHERE status='pending'"))
      .length,
    0
  );
  assert.equal((await call('/session', host)).data.hostConnected, false);
  await store.rows(
    "UPDATE party_rooms SET expires_at=now()-interval '1 second' WHERE id=$1",
    [room.id]
  );
  assert.equal(
    (await call(`/rooms/${room.id}/requests`, member)).response.status,
    410
  );
  await jobs.cleanup();
  for (const table of [
    'party_rooms',
    'party_requests',
    'party_match_candidates',
    'party_jobs',
    'party_delivery_attempts',
    'party_memberships',
  ]) {
    assert.equal((await store.rows(`SELECT * FROM ${table}`)).length, 0, table);
  }
  const internal = await fetch(`${base}/internal/party/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CloudTasks-TaskName': 'fake',
    },
    body: '{}',
  });
  assert.equal(internal.status, 401);
  process.env.PARTY_ENABLED = 'false';
  assert.deepEqual((await call('/config')).data, {
    enabled: false,
    telegramUrl: null,
    autoEnabled: false,
  });
  assert.equal((await call('/session', host)).response.status, 404);
});

test('new parties auto-add unnamed guest submissions and selected versions without approval', async () => {
  process.env.PARTY_ENABLED = 'true';
  SpotifyClient.prototype.enqueue.mock.mockImplementation(async () => { queueCalls++; });
  await authorize(host);
  const created = await call('/rooms', host, {});
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const active = created.data.room;
  assert.equal(active.mode, 'auto');
  assert.equal('deviceId' in active, false);
  assert.equal(SpotifyClient.prototype.devices.mock.callCount(), 0);
  const resumed = await call('/rooms', host, {});
  assert.equal(resumed.data.room.id, active.id);
  assert.equal(resumed.data.inviteUrl, created.data.inviteUrl);
  assert.equal((await store.rows("SELECT id FROM party_rooms WHERE status='open'")).length, 1);
  assert.equal((await call('/config')).data.autoEnabled, true);
  const secret = new URL(created.data.inviteUrl).searchParams.get('startapp').slice(2);
  await call('/join', member, { secret });
  const body = { url: `https://open.spotify.com/track/${trackId}`, submissionKey: randomUUID() };
  const first = await call(`/rooms/${active.id}/requests`, member, body);
  assert.equal(first.response.status, 202, JSON.stringify(first.data));
  assert.equal((await call(`/rooms/${active.id}/requests`, member, body)).data.id, first.data.id);
  const before = queueCalls;
  await runPending(first.data.id, 'resolve');
  const [resolved] = await store.rows('SELECT * FROM party_requests WHERE id=$1', [first.data.id]);
  assert.equal(resolved.display_name, 'Guest');
  assert.equal(resolved.status, 'approved');
  await runPending(first.data.id, 'deliver');
  await runPending(first.data.id, 'deliver');
  assert.equal(queueCalls, before + 1);
  const receipt = (await call(`/rooms/${active.id}/requests`, member)).data.requests[0];
  assert.equal(receipt.status, 'added');

  // Seed an ambiguous resolver result to exercise the version-choice transition.
  const second = await call(`/rooms/${active.id}/requests`, member, { ...body, submissionKey: randomUUID() });
  await store.rows("UPDATE party_requests SET status='needs_review',confidence='ambiguous' WHERE id=$1", [second.data.id]);
  await store.rows('INSERT INTO party_match_candidates(request_id,track_id,metadata) VALUES($1,$2,$3)', [second.data.id, trackId, resolved.selected]);
  assert.equal((await call(`/rooms/${active.id}/requests/${second.data.id}/action`, member, { action: 'select', candidateId: trackId })).response.status, 403);
  assert.equal((await call(`/rooms/${active.id}/requests/${second.data.id}/action`, host, { action: 'select', candidateId: 'invalid' })).response.status, 400);
  assert.equal(queueCalls, before + 1, 'ambiguous songs must not silently enqueue');
  const selected = await call(`/rooms/${active.id}/requests/${second.data.id}/action`, host, { action: 'select', candidateId: trackId });
  assert.equal(selected.response.status, 200, JSON.stringify(selected.data));
  await runPending(second.data.id, 'deliver');
  assert.equal(queueCalls, before + 2, 'choosing a version does not require a second approval');
  await call(`/rooms/${active.id}/action`, host, { action: 'close' });
});

test('iTunes retry is durable; missing ISRC needs host choice in auto rooms; outages are not no-match', async t => {
  await authorize(host);
  const created = await call('/rooms', host, {});
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const active = created.data.room;
  assert.equal(active.mode, 'auto');
  const secret = new URL(created.data.inviteUrl).searchParams.get('startapp').slice(2);
  assert.equal((await call('/join', member, { secret })).response.status, 200);
  const originalFetch = globalThis.fetch;
  let status = 429;
  let lookupCalls = 0;
  let searches = 0;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(String(input));
    if (url.origin === base) return originalFetch(input, options);
    assert.equal(url.toString(), 'https://itunes.apple.com/lookup?id=1814958889&country=il');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    lookupCalls++;
    return status === 200 ? Response.json({
      resultCount: 1,
      results: [{
        wrapperType: 'track', kind: 'song', trackId: 1814958889,
        trackName: track.name, artistName: 'Artist', collectionName: 'Album',
        trackTimeMillis: track.duration_ms, trackExplicitness: 'notExplicit',
        collectionExplicitness: 'explicit',
      }],
    }) : new Response('Provider unavailable', { status, headers: { 'Retry-After': '75' } });
  });
  t.mock.method(SpotifyClient.prototype, 'search', async (_token, query) => {
    searches++;
    assert.equal(query, 'track:"test song" artist:"artist"');
    return [track];
  });
  const submitApple = async () => {
    const response = await call(`/rooms/${active.id}/requests`, member, {
      url: 'https://music.apple.com/il/album/not-trusted/1814958890?i=1814958889',
      submissionKey: randomUUID(),
    });
    assert.equal(response.response.status, 202, JSON.stringify(response.data));
    return response.data.id;
  };
  const id = await submitApple();
  const before = queueCalls;
  const started = Date.now();
  await runPending(id, 'resolve');
  let [job] = await store.rows("SELECT * FROM party_jobs WHERE request_id=$1 AND kind='resolve'", [id]);
  let [request] = await store.rows('SELECT * FROM party_requests WHERE id=$1', [id]);
  assert.equal(job.status, 'pending');
  assert.equal(job.failures, 0);
  assert.ok(job.due_at.getTime() >= started + 74_000);
  assert.equal(request.status, 'pending');
  assert.equal(request.failure_code, 'itunes_rate_limited');
  assert.equal(lookupCalls, 1);
  assert.equal(searches, 0);
  assert.equal(queueCalls, before);
  await assert.rejects(runPending(id, 'resolve'), error => error.code === 'task_not_due');
  assert.equal(lookupCalls, 1, 'a future job must not make an early provider retry');

  status = 200;
  await store.rows('UPDATE party_jobs SET due_at=now() WHERE id=$1', [job.id]);
  await runPending(id, 'resolve');
  [request] = await store.rows('SELECT * FROM party_requests WHERE id=$1', [id]);
  assert.equal(request.status, 'needs_review');
  assert.equal(request.confidence, 'ambiguous');
  assert.equal(request.failure_code, null);
  assert.equal(request.source.isrc, undefined);
  assert.equal(request.source.explicit, false);
  assert.equal(lookupCalls, 2);
  assert.equal(searches, 1);
  assert.equal((await store.rows("SELECT id FROM party_jobs WHERE request_id=$1 AND kind='deliver'", [id])).length, 0);
  assert.equal(queueCalls, before, 'otherwise-identical metadata cannot fill missing recording identity');
  assert.equal((await call(`/rooms/${active.id}/requests/${id}/action`, member, {
    action: 'select', candidateId: trackId,
  })).response.status, 403);
  const selected = await call(`/rooms/${active.id}/requests/${id}/action`, host, {
    action: 'select', candidateId: trackId,
  });
  assert.equal(selected.response.status, 200, JSON.stringify(selected.data));
  await runPending(id, 'deliver');
  assert.equal(queueCalls, before + 1, 'host version choice queues via mocked active Spotify playback without extra approval');

  status = 503;
  const outage = await submitApple();
  for (let attempt = 0; attempt < 5; attempt++) {
    await store.rows('UPDATE party_jobs SET due_at=now() WHERE request_id=$1', [outage]);
    await runPending(outage, 'resolve');
  }
  [job] = await store.rows("SELECT * FROM party_jobs WHERE request_id=$1 AND kind='resolve'", [outage]);
  [request] = await store.rows('SELECT * FROM party_requests WHERE id=$1', [outage]);
  assert.equal(job.status, 'done');
  assert.equal(job.failures, 4);
  assert.equal(request.status, 'failed');
  assert.equal(request.failure_code, 'itunes_unavailable');
  assert.equal(lookupCalls, 7, 'one lookup per bounded read attempt, without a hidden retry or fallback');
  assert.equal(searches, 1);
  assert.equal(queueCalls, before + 1);
  await call(`/rooms/${active.id}/action`, host, { action: 'close' });
});

test('read-only room search and explicit submitter selection preserve authorization, idempotency and delivery', async t => {
  await store.rows('DELETE FROM party_throttles');
  await authorize(host);
  const created = await makeRoom(host);
  const active = created.room;
  assert.equal(active.mode, 'host_approval', 'new selections must also bypass legacy routine approval');
  const secret = new URL(created.inviteUrl).searchParams.get('startapp').slice(2);
  await call('/join', member, { secret });
  const path = `/rooms/${active.id}`;
  const url = `https://open.spotify.com/track/${trackId}`;
  let trackCalls = 0;
  let spotifyFailure;
  t.mock.method(SpotifyClient.prototype, 'track', async () => {
    trackCalls++;
    if (spotifyFailure) throw spotifyFailure;
    return track;
  });
  t.mock.method(SpotifyClient.prototype, 'enqueue', async () => { queueCalls++; });
  const count = async table => (await store.rows(`SELECT count(*)::int AS count FROM ${table}`))[0].count;
  const requestsBefore = await count('party_requests');
  const jobsBefore = await count('party_jobs');
  const queuedBefore = queueCalls;
  assert.equal((await call(`${path}/search`, null, { url })).response.status, 401);
  assert.equal((await call(`${path}/search`, outsider, { url })).response.status, 403);
  assert.equal((await call(`${path}/search`, member, { url }, { 'X-Party-CSRF': 'bad' })).response.status, 403);
  assert.equal((await call(`${path}/search`, member, { url }, { Origin: 'https://evil.test' })).response.status, 403);
  for (const value of ['', 'https://open.spotify.com/track/partial', 'https://music.apple.com/us/album/123', 'http://localhost/']) {
    assert.equal((await call(`${path}/search`, member, { url: value })).response.status, 400);
  }
  assert.equal(trackCalls, 0);
  const found = await call(`${path}/search`, member, { url });
  assert.equal(found.response.status, 200, JSON.stringify(found.data));
  assert.equal(found.data.candidates.length, 1);
  const candidate = found.data.candidates[0];
  assert.equal(candidate.id, trackId);
  assert.equal(await count('party_requests'), requestsBefore);
  assert.equal(await count('party_jobs'), jobsBefore);
  assert.equal(queueCalls, queuedBefore);
  const selection = { selectionToken: candidate.selectionToken };
  const [payload, signature] = candidate.selectionToken.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(decoded.source.url, url);
  assert.equal(JSON.stringify(decoded).includes('accessToken'), false);
  const tamper = changed => `${Buffer.from(JSON.stringify({ ...decoded, ...changed })).toString('base64url')}.${signature}`;
  for (const selectionToken of [
    tamper({ candidate: { ...decoded.candidate, id: 'ZZZZZZZZZZZZZZZZZZZZZZ' } }),
    tamper({ source: { ...decoded.source, url: 'https://evil.test/' } }),
    tamper({ expires: Date.now() + 86_400_000 }),
    `${candidate.selectionToken}.extra`,
  ]) {
    assert.equal((await call(`${path}/selections`, member, { selectionToken })).data.error.code, 'invalid_candidate');
  }
  assert.equal((await call(`${path}/selections`, host, selection)).response.status, 403);
  assert.equal((await call(`${path}/selections`, outsider, selection)).response.status, 403);
  assert.equal((await call('/rooms/another-room/selections', member, selection)).response.status, 403);
  assert.equal((await call(`${path}/selections`, member, selection, { 'X-Party-CSRF': '' })).response.status, 403);
  const anotherSession = await guest(200);
  await call('/join', anotherSession, { secret });
  assert.equal((await call(`${path}/selections`, anotherSession, selection)).response.status, 403, 'even same-principal sessions cannot share offers');
  const expiredPayload = Buffer.from(JSON.stringify({ ...decoded, expires: Date.now() - 1000 })).toString('base64url');
  const expiredSignature = createHmac('sha256', Buffer.from(process.env.PARTY_IDENTITY_KEY, 'hex'))
    .update(`party-selection-v1:${expiredPayload}`).digest('hex');
  assert.equal((await call(`${path}/selections`, member, { selectionToken: `${expiredPayload}.${expiredSignature}` })).data.error.code, 'search_expired');
  await store.rows('DELETE FROM party_memberships WHERE room_id=$1 AND session_id=$2', [active.id, decoded.session]);
  assert.equal((await call(`${path}/selections`, member, selection)).response.status, 403);
  await call('/join', member, { secret });
  const selected = await Promise.all([call(`${path}/selections`, member, selection), call(`${path}/selections`, member, selection)]);
  assert.ok(selected.some(response => response.response.status === 202));
  assert.ok(selected.every(response => response.response.status === 202 || response.data.error.code === 'host_busy'));
  const id = selected.find(response => response.response.status === 202).data.id;
  assert.equal((await call(`${path}/selections`, member, selection)).data.id, id);
  assert.ok(selected.filter(response => response.response.status === 202).every(response => response.data.id === id));
  assert.equal(await count('party_requests'), requestsBefore + 1);
  assert.equal(await count('party_jobs'), jobsBefore + 1);
  assert.equal(queueCalls, queuedBefore, 'outbox creation is not success');
  const [request] = await store.rows('SELECT * FROM party_requests WHERE id=$1', [id]);
  assert.equal(request.status, 'approved');
  assert.equal(request.selected.id, trackId);
  assert.equal((await store.rows('SELECT kind FROM party_jobs WHERE request_id=$1', [id]))[0].kind, 'deliver');
  await runPending(id, 'deliver');
  await runPending(id, 'deliver');
  assert.equal(queueCalls, queuedBefore + 1);
  assert.equal((await call(`${path}/requests`, member)).data.requests.find(item => item.id === id).status, 'added');
  assert.equal((await call(`${path}/requests/${id}/action`, member, { action: 'select', candidateId: trackId })).response.status, 403, 'legacy host-only controls stay host-only');

  // Missing recording identity still offers choices, but never silently chooses one.
  const originalFetch = globalThis.fetch;
  let itunesStatus = 200;
  let empty = false;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const lookup = new URL(String(input));
    if (lookup.origin === base) return originalFetch(input, options);
    assert.equal(lookup.toString(), 'https://itunes.apple.com/lookup?id=123456789&country=il');
    return itunesStatus === 200 ? Response.json({
      resultCount: empty ? 0 : 1,
      results: empty ? [] : [{ wrapperType: 'track', kind: 'song', trackId: 123456789, trackName: track.name,
        artistName: 'Artist', collectionName: 'Album', trackTimeMillis: track.duration_ms, trackExplicitness: 'notExplicit' }],
    }) : new Response('', { status: itunesStatus, headers: { 'Retry-After': '75' } });
  });
  const alternate = { ...track, id: 'ZZZZZZZZZZZZZZZZZZZZZZ' };
  let searchResults = [track, alternate, { ...track, id: 'YYYYYYYYYYYYYYYYYYYYYY', name: 'Test Song - Live' }];
  t.mock.method(SpotifyClient.prototype, 'search', async () => searchResults);
  const apple = { url: 'https://music.apple.com/il/album/album/123456788?i=123456789' };
  const choices = await call(`${path}/search`, member, apple);
  assert.equal(choices.response.status, 200, JSON.stringify(choices.data));
  assert.equal(choices.data.candidates.length, 2, 'contradictory live version must remain excluded');
  assert.equal(await count('party_requests'), requestsBefore + 1);
  assert.equal(await count('party_jobs'), jobsBefore + 1);
  const choice = choices.data.candidates[0];
  const chosen = await call(`${path}/selections`, member, { selectionToken: choice.selectionToken });
  assert.equal(chosen.response.status, 202, JSON.stringify(chosen.data));
  assert.equal((await call(`${path}/selections`, member, { selectionToken: choices.data.candidates[1].selectionToken })).data.error.code, 'submission_conflict');
  await runPending(chosen.data.id, 'deliver');
  assert.equal(queueCalls, queuedBefore + 2);

  await store.rows('DELETE FROM party_throttles');
  for (const status of [429, 503]) {
    itunesStatus = status;
    const failure = await call(`${path}/search`, member, apple);
    assert.equal(failure.response.status, status);
    assert.equal(failure.data.candidates, undefined, 'provider errors are never Not found');
    if (status === 429) assert.equal(failure.response.headers.get('retry-after'), '75');
  }
  itunesStatus = 200;
  empty = true;
  assert.deepEqual((await call(`${path}/search`, member, apple)).data.candidates, []);
  empty = false;
  searchResults = [];
  assert.deepEqual((await call(`${path}/search`, member, apple)).data.candidates, []);
  spotifyFailure = new SpotifyError('rate_limited', 429, 30);
  const limited = await call(`${path}/search`, member, { url });
  assert.equal(limited.response.status, 429, JSON.stringify(limited.data));
  spotifyFailure = undefined;
  await call(`${path}/search`, member, { url });
  const beforeThrottled = trackCalls;
  assert.equal((await call(`${path}/search`, member, { url })).response.status, 429);
  assert.equal(trackCalls, beforeThrottled, 'search throttle must run before providers');

  await store.rows('DELETE FROM party_throttles');
  spotifyFailure = new SpotifyError('unauthorized', 401);
  const unauthorized = await call(`${path}/search`, member, { url });
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.data.error.code, 'unauthorized');
  assert.equal(unauthorized.data.candidates, undefined);
  spotifyFailure = new SpotifyError('network');
  assert.equal((await call(`${path}/search`, member, { url })).response.status, 503);
  spotifyFailure = undefined;
  const hostResult = await call(`${path}/search`, host, { url });
  assert.equal(hostResult.response.status, 200);
  await call(`${path}/action`, host, { action: 'lock' });
  assert.equal((await call(`${path}/selections`, host, { selectionToken: hostResult.data.candidates[0].selectionToken })).data.error.code, 'room_locked');
  assert.equal((await call(`${path}/search`, host, { url })).data.error.code, 'room_locked');
  await call(`${path}/action`, host, { action: 'unlock' });
  const hostSelected = await call(`${path}/selections`, host, { selectionToken: hostResult.data.candidates[0].selectionToken });
  assert.equal(hostSelected.response.status, 202);
  await runPending(hostSelected.data.id, 'deliver');
  assert.equal(queueCalls, queuedBefore + 3);
  // A new intentional search permits the same song again; its saved metadata is still revalidated.
  const repeat = await call(`${path}/search`, member, { url });
  const repeated = await call(`${path}/selections`, member, { selectionToken: repeat.data.candidates[0].selectionToken });
  assert.notEqual(repeated.data.id, id);
  const changedTrack = { ...track, name: 'Test Song - Live' };
  SpotifyClient.prototype.track.mock.mockImplementation(async () => changedTrack);
  await runPending(repeated.data.id, 'deliver');
  assert.equal(queueCalls, queuedBefore + 3, 'recording drift cannot send even an explicitly selected song');
  assert.equal((await store.rows('SELECT failure_code FROM party_requests WHERE id=$1', [repeated.data.id]))[0].failure_code, 'recording_changed');
  SpotifyClient.prototype.track.mock.mockImplementation(async () => track);
  const unsent = await call(`${path}/search`, host, { url });
  const pending = await call(`${path}/selections`, host, { selectionToken: unsent.data.candidates[0].selectionToken });
  assert.equal(pending.response.status, 202);
  await call(`${path}/action`, host, { action: 'close' });
  await runPending(pending.data.id, 'deliver');
  assert.equal((await call(`${path}/selections`, member, selection)).data.error.code, 'room_closed');
  assert.equal((await call(`${path}/search`, member, { url })).data.error.code, 'room_closed');
  assert.equal(queueCalls, queuedBefore + 3);
  await store.rows("UPDATE party_rooms SET expires_at=now()-interval '1 second' WHERE id=$1", [active.id]);
  assert.equal((await call(`${path}/search`, member, { url })).data.error.code, 'room_expired');
  assert.equal((await call(`${path}/selections`, member, selection)).data.error.code, 'room_expired');
});

test('selected search result reaches one mocked 204 with host-market revalidation, failing closed on changed evidence', async t => {
  await store.rows('DELETE FROM party_throttles');
  await authorize(host);
  const { room: active } = await makeRoom(host);
  const route = `/rooms/${active.id}`;
  const originalFetch = globalThis.fetch;
  t.mock.method(SpotifyClient.prototype, 'track', spotifyTrack);
  t.mock.method(SpotifyClient.prototype, 'enqueue', spotifyEnqueue);
  let deliveredTrack = track;
  let sends = 0;
  const metadataMarkets = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(String(input));
    if (url.origin === base) return originalFetch(input, options);
    if (url.origin === 'https://itunes.apple.com') {
      return Response.json({
        resultCount: 1,
        results: [{ wrapperType: 'track', kind: 'song', trackId: 123456789, trackName: track.name,
          artistName: 'Artist', collectionName: 'Album', trackTimeMillis: track.duration_ms,
          trackExplicitness: 'notExplicit' }],
      });
    }
    assert.equal(url.origin, 'https://api.spotify.com');
    if (url.pathname === '/v1/search') {
      metadataMarkets.push(url.searchParams.get('market'));
      return Response.json({ tracks: { items: [track] } });
    }
    if (url.pathname === `/v1/tracks/${trackId}`) {
      metadataMarkets.push(url.searchParams.get('market'));
      return Response.json({
        ...deliveredTrack,
        is_playable: url.searchParams.has('market') ? deliveredTrack.is_playable : undefined,
      });
    }
    assert.equal(url.pathname, '/v1/me/player/queue');
    assert.equal(options.method, 'POST');
    assert.equal(url.searchParams.get('uri'), `spotify:track:${trackId}`);
    assert.equal(url.searchParams.has('device_id'), false);
    sends++;
    return new Response(null, { status: 204 });
  });
  for (const [variant, failureCode] of [
    [{}, null],
    [{ is_playable: undefined }, 'track_unavailable'],
    [{ is_playable: false }, 'track_unavailable'],
    [{ restrictions: { reason: 'market' } }, 'track_unavailable'],
    [{ id: 'ZZZZZZZZZZZZZZZZZZZZZZ', linked_from: { id: trackId } }, 'track_unavailable'],
    [{ name: 'Test Song - Live' }, 'recording_changed'],
  ]) {
    deliveredTrack = { ...track, ...variant };
    const found = await call(`${route}/search`, host, {
      url: 'https://music.apple.com/il/album/album/123456788?i=123456789',
    });
    assert.equal(found.response.status, 200, JSON.stringify(found.data));
    assert.equal(found.data.candidates.length, 1);
    const selected = await call(`${route}/selections`, host, {
      selectionToken: found.data.candidates[0].selectionToken,
    });
    assert.equal(selected.response.status, 202, JSON.stringify(selected.data));
    await runPending(selected.data.id, 'deliver');
    await runPending(selected.data.id, 'deliver');
    const [receipt] = await store.rows('SELECT status,failure_code FROM party_requests WHERE id=$1', [selected.data.id]);
    assert.equal(receipt.status, failureCode === 'recording_changed' ? 'failed' : failureCode ? 'unavailable' : 'added');
    assert.equal(receipt.failure_code, failureCode);
    const attempts = await store.rows('SELECT outcome FROM party_delivery_attempts WHERE request_id=$1', [selected.data.id]);
    assert.deepEqual(attempts, failureCode ? [] : [{ outcome: 'accepted' }]);
    assert.equal(sends, 1, 'only positive unchanged evidence sends, and a completed job never resends');
  }
  assert.equal(metadataMarkets.length, 12);
  assert.ok(metadataMarkets.every(market => market === 'from_token'));
  await call(`${route}/action`, host, { action: 'close' });
});
