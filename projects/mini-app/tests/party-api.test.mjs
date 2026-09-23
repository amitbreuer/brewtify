import test from 'node:test';
import assert from 'node:assert/strict';
import { errorText, PartyClient, PartyError } from '../src/features/party/api.ts';

test('Party bootstrap uses only signed initData; mutations use same-origin cookies and CSRF', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ csrfToken: 'csrf-example', hostConnected: false, room: null });
  });
  const client = new PartyClient();
  await client.session('signed-init-data');
  await client.request('/join', { secret: 'opaque-room-capability' });
  await client.session();
  assert.equal(calls[0].url, '/api/party/session');
  assert.deepEqual(JSON.parse(calls[0].options.body), { initData: 'signed-init-data' });
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers['X-Telegram-User-Id'], undefined);
  assert.equal(calls[0].options.headers['X-Party-CSRF'], undefined);
  assert.equal(calls[1].options.headers['X-Party-CSRF'], 'csrf-example');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[2].options.method, 'GET');
  assert.equal(calls[2].options.body, undefined);
});

test('server errors preserve code and rate limit timing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(
    { error: { code: 'rate_limited', message: 'Slow down' } },
    { status: 429, headers: { 'Retry-After': '90' } },
  ));
  await assert.rejects(new PartyClient().request('/rooms'), (error) => {
    assert.ok(error instanceof PartyError);
    assert.equal(error.code, 'rate_limited');
    assert.equal(error.message, 'Slow down');
    assert.equal(error.retryAfterMs, 90_000);
    return true;
  });
});

test('failed mutations are never automatically replayed', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new TypeError('Network unavailable');
  });

  await assert.rejects(new PartyClient().request('/rooms/room/requests/id/action', { action: 'retry', confirmDuplicateRisk: true }), PartyError);
  assert.equal(calls, 1);
});

test('iTunes errors display catalog-specific guidance rather than Spotify or Telegram authentication', () => {
  for (const [code, status] of [
    ['itunes_rejected', 401], ['itunes_unavailable', 503], ['itunes_invalid_response', 503],
    ['itunes_rate_limited', 429],
  ]) {
    const message = errorText(new PartyError('Raw catalog error', code, status, 75_000));
    assert.match(message, /iTunes Store/);
    assert.doesNotMatch(message, /session expired|reconnect|credentials|Raw catalog error/i);
  }
});

test('reload restores its cookie session without replaying signed launch data', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls.push(options);
    return Response.json({ csrfToken: 'restored', hostConnected: true, room: null });
  });
  const result = await new PartyClient().restore('original-signed-launch');
  assert.equal(result.hostConnected, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
});

test('only a missing or expired session triggers signed Telegram bootstrap', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls.push(options);
    return calls.length === 1
      ? Response.json({ error: { code: 'session_expired', message: 'Expired' } }, { status: 401 })
      : Response.json({ csrfToken: 'new', hostConnected: false, room: null });
  });
  await new PartyClient().restore('fresh-signed-launch');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].body), { initData: 'fresh-signed-launch' });
});

test('temporary restore failures do not consume another Telegram launch', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ error: { code: 'unavailable', message: 'Try later' } }, { status: 503 });
  });
  await assert.rejects(new PartyClient().restore('signed-launch'), PartyError);
  assert.equal(calls, 1);
});
