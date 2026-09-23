import test from 'node:test';
import assert from 'node:assert/strict';
import { partyPreviewPlugins } from '../dev/party-preview.ts';
import { partyFailureMessage } from '../src/features/party/messages.ts';
import { PartyDemoClient } from '../dev/party-demo.ts';

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
  assert.match(partyFailureMessage('device_unavailable'), /start playing music, then tap Try again/);
  assert.match(partyFailureMessage('delivery_settling'), /two-minute safety window/);
  assert.equal(partyFailureMessage('recording_changed'), 'Spotify recording details changed. Resolve the request again and approve the version before adding.');
  for (const code of ['apple_configuration', 'apple_unauthorized', 'apple_rate_limited', 'apple_unavailable', 'apple_invalid_response', 'apple_rejected']) {
    assert.match(partyFailureMessage(code), /Apple Music/);
    assert.doesNotMatch(partyFailureMessage(code), /Party needs attention/);
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
    await guest.request('/rooms/demo-room/requests', { url: 'https://open.spotify.com/track/demo' });
    const after = await guest.request('/rooms/demo-room/requests');
    assert.equal(after.requests.length, 2);
    assert.equal(after.requests[1].status, 'added');
  } finally {
    globalThis.fetch = original;
  }
});
