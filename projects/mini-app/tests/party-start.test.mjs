import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { act, createElement as h } from 'react';
import QRCode from 'qrcode';

let vite, dom, createRoot, Party, PartyClient, PartyError, ToastProvider, root, container;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/app/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  vite = await createServer({
    configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom',
    ssr: { external: ['@brewtify/shared'] }, optimizeDeps: { noDiscovery: true },
    cacheDir: 'node_modules/.vite-party-start-tests',
  });
  ({ default: Party } = await vite.ssrLoadModule('/src/features/party/Party.tsx'));
  ({ PartyClient, PartyError } = await vite.ssrLoadModule('/src/features/party/api.ts'));
  ({ ToastProvider } = await vite.ssrLoadModule('/src/hooks/useToast.tsx'));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  container?.remove();
});
after(async () => {
  await vite?.close();
  dom?.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

async function mount(t, { connected = false, existing = null, authResult = 'complete', creationFails = false, invitation = null } = {}) {
  const calls = [], opened = [];
  const hostRoom = { id: 'room', isHost: true, status: 'open', mode: 'auto', blockedReason: null };
  let room = existing, auth = 'idle', creations = 0;
  window.Telegram = { WebApp: { initData: 'signed-fixture', openLink: url => opened.push(url) } };
  t.mock.method(QRCode, 'toDataURL', async () => 'data:image/png;base64,test');
  t.mock.method(globalThis, 'fetch', () => assert.fail('No real network in UI tests'));
  t.mock.method(PartyClient.prototype, 'restore', async () => ({ hostConnected: connected, room }));
  t.mock.method(PartyClient.prototype, 'request', async (path, body) => {
    calls.push({ path, body });
    if (path === '/auth/status') return { status: auth, ...(auth === 'failed' ? { error: 'authorization_cancelled' } : {}) };
    if (path === '/auth/start') {
      assert.deepEqual(body, {});
      auth = authResult;
      connected = auth === 'complete';
      if (room) room = { ...room, blockedReason: null };
      return { authorizationUrl: 'https://example.invalid/oauth' };
    }
    if (path === '/session') return { hostConnected: connected, room };
    if (path === '/rooms') {
      assert.deepEqual(body, {});
      creations++;
      if (creationFails && creations === 1) throw new PartyError('Temporary creation failure', 'party_unavailable', 503);
      room = hostRoom;
      return { room };
    }
    if (path === '/join') {
      room = { ...hostRoom, isHost: false };
      return { room };
    }
    if (path.endsWith('/invite')) return { inviteUrl: 'https://example.invalid/invite' };
    if (path.includes('/requests')) return { room, requests: [], nextCursor: null };
    assert.fail(`Unexpected path: ${path}`);
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(h(ToastProvider, null, h(Party, {
    config: { enabled: true, autoEnabled: true, telegramUrl: null },
    initialSecret: invitation, onInviteConsumed() {},
  }))));
  return { calls, opened };
}
const button = text => [...container.querySelectorAll('button')].find(element => element.textContent === text);

test('Start party opens OAuth in one click with no Premium declaration, then opens the room', async t => {
  const { calls, opened } = await mount(t);
  assert.equal(container.querySelector('input[type=checkbox]'), null);
  assert.doesNotMatch(container.textContent, /Premium|Rooms expire|Library login|playback permission/);
  assert.equal(button('Start party').disabled, false);
  await act(async () => button('Start party').click());
  assert.deepEqual(opened, ['https://example.invalid/oauth']);
  assert.equal(calls.filter(call => call.path === '/auth/start').length, 1);
  assert.equal(calls.filter(call => call.path === '/rooms').length, 1);
  assert.ok(container.querySelector('[aria-label="End party"]'));
});

test('connected host creates a room without reauthorizing', async t => {
  const { calls, opened } = await mount(t, { connected: true });
  assert.deepEqual(opened, []);
  assert.equal(calls.filter(call => call.path === '/rooms').length, 1);
  assert.equal(calls.filter(call => call.path === '/auth/start').length, 0);
  assert.ok(container.querySelector('[aria-label="End party"]'));
});

test('reconnect reuses the existing room without a Premium checkbox', async t => {
  const existing = { id: 'room', isHost: true, status: 'open', mode: 'auto', blockedReason: 'insufficient_scope' };
  const { calls, opened } = await mount(t, { connected: true, existing });
  await act(async () => button('Reconnect Spotify').click());
  assert.deepEqual(opened, ['https://example.invalid/oauth']);
  assert.equal(calls.filter(call => call.path === '/rooms').length, 0);
  assert.equal(container.querySelector('input[type=checkbox]'), null);
});

test('cancelled OAuth returns an actionable error and allows a new start', async t => {
  const { calls } = await mount(t, { authResult: 'failed' });
  await act(async () => button('Start party').click());
  assert.match(container.querySelector('[role=alert]').textContent, /authorization cancelled/);
  assert.equal(button('Start party').disabled, false);
  assert.equal(calls.filter(call => call.path === '/rooms').length, 0);
});

test('room creation failure is not retried without another user click', async t => {
  const { calls } = await mount(t, { connected: true, creationFails: true });
  assert.equal(container.querySelector('[role=alert]').textContent, 'Temporary creation failure');
  assert.equal(calls.filter(call => call.path === '/rooms').length, 1);
  await act(async () => button('Start party').click());
  assert.equal(calls.filter(call => call.path === '/rooms').length, 2);
  assert.equal(calls.filter(call => call.path === '/auth/start').length, 0);
});

test('invited guest joins without Spotify authorization or host consent', async t => {
  const { calls, opened } = await mount(t, { invitation: 'test-invite' });
  assert.equal(calls.filter(call => call.path === '/join').length, 1);
  assert.equal(calls.filter(call => call.path === '/auth/start').length, 0);
  assert.deepEqual(opened, []);
  assert.equal(container.querySelector('input[type=checkbox]'), null);
  assert.match(container.textContent, /Your songs/);
  assert.doesNotMatch(container.textContent, /Premium|Reconnect Spotify/);
});
