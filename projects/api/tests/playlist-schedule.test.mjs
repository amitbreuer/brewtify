import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import shared from '@brewtify/shared';

// Run the actual route handlers with external services stubbed; no credentials or network.
function loadSource(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  runInNewContext(outputText, {
    exports, Date, Map, Set,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

const logger = { createLogger: () => ({ info() {}, error() {}, warn() {} }) };
const schedule = loadSource('../src/services/scheduler.ts', {
  'p-queue': { default: class {} }, '@brewtify/shared': shared, './db': {}, './spotify': {},
  '../routes/auth': {}, '../utils/logger': logger, '@brewtify/tap': {},
});

const playlist = () => ({
  id: 'db-id', schedule: 'weekly', nextUpdateAt: new Date('2026-10-09T00:00:00Z'),
  lastUpdatedAt: new Date('2026-10-02T12:00:00Z'), createdAt: new Date('2026-09-01T12:00:00Z'),
  artistIds: ['artist'], trackCount: 100, status: 'paused',
});

function fixture(stored = playlist()) {
  const handlers = new Map();
  const calls = { create: [], upsert: [], update: [], replace: [] };
  const router = { use() {} };
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
    router[method] = (path, handler) => handlers.set(`${method} ${path}`, handler);
  }
  loadSource('../src/routes/spotify.ts', {
    express: { Router: () => router },
    '../services/spotify': { spotifyService: {
      async createPlaylist(...args) { calls.create.push(args); return { id: 'spotify-id' }; },
      async getAllArtistTracks() { return [{ id: 'track', uri: 'spotify:track:track' }]; },
      async replacePlaylistTracks(...args) { calls.replace.push(args); },
    } },
    '../services/lastfm': {}, '../services/redis-cache': {}, './auth': {},
    '@brewtify/shared': shared,
    '../services/db': { prisma: {
      user: { async findUnique() { return { id: 1 }; } },
      playlist: {
        async findFirst() { return stored; },
        async upsert(value) { calls.upsert.push(value); },
        async update(value) { calls.update.push(value); },
      },
    } },
    '../services/scheduler': schedule,
    '../utils/logger': logger, '@brewtify/tap': { getTap: () => ({ notify() {} }) },
  });
  return {
    calls,
    async request(method, path, body = {}) {
      const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      await handlers.get(`${method} ${path}`)({ body, params: { playlistId: 'spotify-id' }, telegramUserId: '123', spotifyToken: 'test' }, response);
      return response;
    },
  };
}

test('invalid create schedules return 400 before any Spotify or database side effects', async () => {
  for (const invalid of ['days:', 'days:1,1', 'days:7', {}, false]) {
    const f = fixture();
    const response = await f.request('post', '/api/playlists', { userId: 'user', name: 'Mix', artistIds: ['artist'], schedule: invalid });
    assert.equal(response.code, 400);
    assert.equal(f.calls.create.length, 0);
    assert.equal(f.calls.upsert.length, 0);
  }
});

test('creation persists canonical weekdays and a selected UTC next-update date', async () => {
  const f = fixture();
  const response = await f.request('post', '/api/playlists', { userId: 'user', name: 'Mix', artistIds: ['artist'], schedule: 'days:5,1' });
  assert.equal(response.code, 200);
  const { create, update } = f.calls.upsert[0];
  assert.equal(create.schedule, 'days:1,5');
  assert.equal(update.schedule, 'days:1,5');
  assert.ok([1, 5].includes(create.nextUpdateAt.getUTCDay()));
  assert.equal(create.nextUpdateAt.getUTCHours(), 0);
});

test('None clears the next due date and does not change paused status', async () => {
  const f = fixture();
  const response = await f.request('patch', '/api/playlists/:playlistId/settings', { schedule: null });
  assert.equal(response.code, 200);
  assert.equal(f.calls.update[0].data.schedule, null);
  assert.equal(f.calls.update[0].data.nextUpdateAt, null);
  assert.equal(f.calls.update[0].data.status, undefined);
});

test('invalid settings leave the database untouched, enabling resets failures', async () => {
  const f = fixture();
  assert.equal((await f.request('patch', '/api/playlists/:playlistId/settings', { schedule: 'invalid' })).code, 400);
  assert.equal(f.calls.update.length, 0);
  assert.equal((await f.request('patch', '/api/playlists/:playlistId/settings', { schedule: 'days:4,0' })).code, 200);
  const data = f.calls.update[0].data;
  assert.equal(data.schedule, 'days:0,4');
  assert.equal(data.status, 'active');
  assert.equal(data.failureCount, 0);
  assert.equal(data.lastError, null);
});

test('legacy weekly read uses its due weekday without writing or unpausing', async () => {
  const f = fixture();
  const response = await f.request('get', '/api/playlists/:playlistId/settings');
  assert.equal(response.code, 200);
  assert.equal(response.body.schedule, 'days:5');
  assert.equal(response.body.status, 'paused');
  assert.equal(f.calls.update.length, 0);
  assert.equal(schedule.normalizePlaylistSchedule({ ...playlist(), nextUpdateAt: null }), 'days:5');
  assert.equal(schedule.normalizePlaylistSchedule({ ...playlist(), nextUpdateAt: null, lastUpdatedAt: null }), 'days:2');
  assert.equal(schedule.calculateNextUpdate('days:5', new Date('2026-10-10T12:00:00Z')).toISOString(), '2026-10-16T00:00:00.000Z');
});

test('manual refresh preserves legacy weekly weekday and supports multiple days', async () => {
  for (const [storedSchedule, expected] of [['weekly', 'days:5'], ['days:0,2,4', 'days:0,2,4']]) {
    const f = fixture({ ...playlist(), schedule: storedSchedule });
    const response = await f.request('post', '/api/playlists/:playlistId/update');
    assert.equal(response.code, 200);
    assert.equal(f.calls.replace.length, 1);
    const data = f.calls.update[0].data;
    assert.equal(data.schedule, expected);
    assert.ok(shared.parseRefreshDays(expected).includes(data.nextUpdateAt.getUTCDay()));
    assert.ok(data.nextUpdateAt > data.lastUpdatedAt);
  }
});

test('scheduled refresh catches up and advances to a selected weekday', async () => {
  const updates = [];
  const replacements = [];
  class Queue {
    promises = [];
    add(fn) { this.promises.push(fn()); }
    async onIdle() { await Promise.all(this.promises); }
  }
  const service = loadSource('../src/services/scheduler.ts', {
    'p-queue': { default: Queue }, '@brewtify/shared': shared,
    './db': { prisma: { playlist: {
      async findMany(query) {
        assert.equal(query.where.status, 'active');
        return [{ ...playlist(), schedule: 'days:1,5', user: { telegramUserId: '123' } }];
      },
      async update(value) { updates.push(value); },
    } } },
    './spotify': { spotifyService: {
      async getAllArtistTracks() { return [{ id: 'track', uri: 'spotify:track:track' }]; },
      async replacePlaylistTracks(...args) { replacements.push(args); },
    } },
    '../routes/auth': { async getAccessTokenForUser() { return 'test'; } },
    '../utils/logger': logger, '@brewtify/tap': { getTap: () => ({ notify() {} }) },
  });
  await service.processScheduledUpdates();
  assert.equal(replacements.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.schedule, 'days:1,5');
  assert.equal(updates[0].data.status, 'active');
  assert.ok([1,5].includes(updates[0].data.nextUpdateAt.getUTCDay()));
  assert.ok(updates[0].data.nextUpdateAt > updates[0].data.lastUpdatedAt);
});

test('Telegram supports weekday schedules, pause/resume, and readable status', async () => {
  const commands = new Map();
  const updates = [];
  const replies = [];
  const stored = { ...playlist(), schedule: 'days:0,2,4', name: 'Mix' };
  class Bot {
    use() {}
    command(name, handler) { commands.set(name, handler); }
    catch() {}
  }
  const botModule = loadSource('../src/bot.ts', {
    grammy: { Bot }, crypto: {}, './utils/env': { env: () => 'test' },
    './services/spotify': {}, './routes/auth': {}, './services/pending-auth-store': {},
    './services/db': { prisma: {
      user: { async findUnique() { return { id: 1 }; } },
      playlist: {
        async findFirst() { return stored; },
        async findMany() { return [stored]; },
        async update(value) { updates.push(value); Object.assign(stored, value.data); },
      },
    } },
    './services/scheduler': schedule, '@brewtify/shared': shared,
    './utils/logger': logger, '@brewtify/tap': { getTap: () => ({ notify() {} }) },
  });
  botModule.createBot();
  const invoke = async (name, text) => commands.get(name)({ from: { id: 123 }, message: { text }, async reply(value) { replies.push(value); } });
  await invoke('schedule', '/schedule Mix days:4,0,2');
  assert.equal(stored.schedule, 'days:0,2,4');
  assert.match(replies.at(-1), /Sun, Tue, Thu/);
  await invoke('pause', '/pause Mix');
  assert.equal(stored.status, 'paused');
  await invoke('resume', '/resume Mix');
  assert.equal(stored.status, 'active');
  assert.ok([0,2,4].includes(stored.nextUpdateAt.getUTCDay()));
  await invoke('status', '/status');
  assert.match(replies.at(-1), /Sun, Tue, Thu/);
  const count = updates.length;
  await invoke('schedule', '/schedule Mix days:2,2');
  assert.equal(updates.length, count);
  assert.match(replies.at(-1), /Invalid schedule/);
});
