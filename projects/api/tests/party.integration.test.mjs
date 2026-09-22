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
  PARTY_HOST_ALLOWLIST: 'test-spotify',
  APPLE_MUSIC_TEAM_ID: 'test',
  APPLE_MUSIC_KEY_ID: 'test',
  APPLE_MUSIC_PRIVATE_KEY: 'test-not-used',
  PARTY_TASKS_PROJECT: 'test',
  PARTY_TASKS_LOCATION: 'test',
  PARTY_TASKS_QUEUE: 'test',
  PARTY_TASKS_SERVICE_ACCOUNT: 'tasks@test.invalid',
  PARTY_TASKS_AUDIENCE: origin,
});
let pg, server, base, store, jobs;
let queueCalls = 0;
let queueFailure;
let providerDevices = [
  { id: 'speaker', name: 'Speaker', isActive: true, isRestricted: false },
];
const trackId = '0123456789ABCDEFGHIJKL';
const scopes = ['user-modify-playback-state', 'user-read-playback-state'];
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
    id: 'test-spotify',
  }));
  mock.method(SpotifyClient.prototype, 'exchange', async () => tokens);
  mock.method(SpotifyClient.prototype, 'refresh', async () => ({
    ...tokens,
    accessToken: 'rotated',
    refreshToken: 'rotated-refresh',
  }));
  mock.method(SpotifyClient.prototype, 'devices', async () => providerDevices);
  mock.method(SpotifyClient.prototype, 'track', async () => track);
  mock.method(SpotifyClient.prototype, 'enqueue', async () => {
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
    deviceId: 'speaker',
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
    2
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
test('external browser PKCE returns to verified principal without shared cookies; callback replay denied', async () => {
  const { state, browserCookie } = await authorize(host);
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
  assert.equal(
    (await call('/rooms', host, { deviceId: 'speaker' })).data.error.code,
    'room_already_exists'
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
  await store.rows(
    "UPDATE party_host_sessions SET token_expires_at=now()-interval '1 second'"
  );
  const first = await call('/devices', host);
  const second = await call('/devices', host);
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
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
  assert.equal(guestFeed.room.deviceId, '');
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
test('locked accepts moderation, not submissions; device changes pause without transfer', async () => {
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
  providerDevices = [
    { id: 'different', name: 'Different', isActive: true, isRestricted: false },
  ];
  const before = queueCalls;
  await runPending(id, 'deliver');
  assert.equal(queueCalls, before);
  assert.equal(
    (await call(`/rooms/${room.id}/requests`, host)).data.room.blockedReason,
    'device_confirmation_required'
  );
  providerDevices = [
    { id: 'speaker', name: 'Speaker', isActive: true, isRestricted: false },
  ];
  await call(`/rooms/${room.id}/action`, host, {
    action: 'device',
    deviceId: 'speaker',
  });
  await runPending(id, 'deliver');
  assert.equal(queueCalls, before + 1);
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
test('auto mode requires opt-in and recording drift requires fresh manual approval', async () => {
  assert.equal(
    (
      await call(`/rooms/${room.id}/action`, host, {
        action: 'mode',
        mode: 'auto',
      })
    ).data.error.code,
    'auto_disabled'
  );
  process.env.PARTY_AUTO_ENABLED = 'true';
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
    process.env.PARTY_AUTO_ENABLED = 'false';
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
