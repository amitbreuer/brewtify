import test from 'node:test';
import assert from 'node:assert/strict';
import { partyPreviewPlugins } from '../dev/party-preview.ts';
import { partyFailureMessage } from '../src/features/party/messages.ts';
import { PartyDemoClient } from '../dev/party-demo.ts';
import { PartyError, errorText } from '../src/features/party/api.ts';

test('visual fixture is absent from production builds and disabled by default', () => {
  assert.deepEqual(partyPreviewPlugins('build', true), []);
  assert.deepEqual(partyPreviewPlugins('serve', false), []);
});

test('visual fixture serves config only; authentication and mutations are never mocked', () => {
  let middleware;
  const [plugin] = partyPreviewPlugins('serve', true);
  assert.equal(plugin.apply, 'serve');
  plugin.configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  let payload;
  const response = { setHeader() {}, end(value) { payload = value; } };
  middleware({ method: 'GET', url: '/api/party/config' }, response, () => assert.fail('Expected config fixture'));
  assert.deepEqual(JSON.parse(payload), { enabled: true, telegramUrl: null, autoEnabled: false });
  assert.equal(response.statusCode, 200);
  for (const [method, url] of [
    ['POST', '/api/party/config'],
    ['GET', '/api/party/session'],
    ['POST', '/api/party/session'],
    ['POST', '/api/party/auth/start'],
    ['POST', '/api/party/rooms'],
    ['GET', '/api/profile'],
  ]) {
    let passed = false;
    middleware({ method, url }, { end() { assert.fail('Unexpected fixture response'); } }, () => { passed = true; });
    assert.equal(passed, true, `${method} ${url}`);
  }
});

test('provider failures have actionable labels without telling guests to log in', () => {
  assert.match(partyFailureMessage('unauthorized'), /reconnect Party Spotify/);
  assert.match(partyFailureMessage('premium_required'), /Premium/);
  assert.match(partyFailureMessage('insufficient_scope'), /grant playback access/);
  for (const code of ['catalog_insufficient_scope', 'catalog_forbidden']) {
    const message = errorText(new PartyError('Provider failed', code, 403));
    assert.match(message, /song lookup/);
    assert.doesNotMatch(message, /playback permission is missing|grant playback access|Premium/i);
  }
  assert.match(partyFailureMessage('forbidden'), /Spotify app access and device restrictions/);
  assert.match(partyFailureMessage('forbidden'), /does not necessarily mean Premium is missing/);
  assert.doesNotMatch(partyFailureMessage('forbidden'), /allowlist|pilot/i);
  assert.match(partyFailureMessage('device_unavailable'), /start playing music, then tap Try again/);
  assert.match(partyFailureMessage('delivery_settling'), /two-minute safety window/);
  assert.equal(partyFailureMessage('recording_changed'), 'Spotify recording details changed. Resolve the request again and approve the version before adding.');
  for (const code of ['itunes_rate_limited', 'itunes_unavailable', 'itunes_invalid_response', 'itunes_rejected']) {
    assert.match(partyFailureMessage(code), /iTunes Store/);
    assert.doesNotMatch(partyFailureMessage(code), /Party needs attention/);
    assert.doesNotMatch(partyFailureMessage(code), /credentials|sign in|developer/i);
  }
});

test('interactive preview changes sample state without calling real APIs', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail('Demo must never make a network request');
  try {
    const host = new PartyDemoClient(true);
    const before = await host.request('/rooms/demo-room/requests');
    assert.equal(before.requests.length, 3);
    assert.equal(before.room.mode, 'auto');
    assert.ok(before.requests.every(song => song.status === 'added'));
    await host.request('/rooms/demo-room/action', { action: 'lock' });
    await assert.rejects(host.request('/rooms/demo-room/requests', { url: 'https://open.spotify.com/track/demo' }));
    await assert.rejects(host.request('/auth/start', {}));
    await assert.rejects(host.restore('unsigned'));
    const guest = new PartyDemoClient(false);
    assert.equal((await guest.request('/rooms/demo-room/requests')).requests.length, 1);
    await assert.rejects(guest.request('/rooms/demo-room/action', { action: 'close' }));
    const result = await guest.request('/rooms/demo-room/search', { url: 'https://music.apple.com/us/song/123456789' });
    assert.equal(result.candidates.length, 1);
    assert.equal((await guest.request('/rooms/demo-room/requests')).requests.length, 1, 'search cannot enqueue');
    const selection = { selectionToken: result.candidates[0].selectionToken };
    const selected = await guest.request('/rooms/demo-room/selections', selection);
    assert.deepEqual(await guest.request('/rooms/demo-room/selections', selection), selected);
    const after = await guest.request('/rooms/demo-room/requests');
    assert.equal(after.requests.length, 2);
    assert.equal(after.requests[1].status, 'approved', 'click is not provider acceptance');
    await new Promise(resolve => setTimeout(resolve, 1510));
    assert.equal((await guest.request('/rooms/demo-room/requests')).requests[1].status, 'added');
  } finally {
    globalThis.fetch = original;
  }
});

test('demo exposes multiple choices, not found, rate errors and uncertain delivery without providers', async () => {
  for (const scenario of ['multiple', 'not_found', 'rate_limited', 'failed', 'unknown', 'pending']) {
    const client = new PartyDemoClient(false, scenario);
    const search = client.request('/rooms/demo-room/search', { url: 'spotify:track:0123456789ABCDEFGHIJKL' });
    if (scenario === 'rate_limited') {
      await assert.rejects(search, error => error.status === 429 && error.retryAfterMs > 0);
      continue;
    }
    const result = await search;
    assert.equal(result.candidates.length, scenario === 'multiple' ? 2 : scenario === 'not_found' ? 0 : 1);
    if (!result.candidates.length) continue;
    await client.request('/rooms/demo-room/selections', { selectionToken: result.candidates[0].selectionToken });
    await new Promise(resolve => setTimeout(resolve, 1510));
    const request = (await client.request('/rooms/demo-room/requests')).requests.at(-1);
    assert.equal(request.status, scenario === 'multiple' ? 'added' : scenario === 'pending' ? 'approved' : 'failed');
    if (scenario === 'unknown') assert.equal(request.failureCode, 'delivery_unknown');
  }
});
