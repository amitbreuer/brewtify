import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { act, createElement as h } from 'react';
import QRCode from 'qrcode';

let vite, dom, createRoot, Room, ToastProvider, root, container;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/app/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  vite = await createServer({
    configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom',
    ssr: { external: ['@brewtify/shared'] }, optimizeDeps: { noDiscovery: true },
    cacheDir: 'node_modules/.vite-room-tests',
  });
  ({ Room } = await vite.ssrLoadModule('/src/features/party/Room.tsx'));
  ({ ToastProvider } = await vite.ssrLoadModule('/src/hooks/useToast.tsx'));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = undefined;
});
after(async () => {
  await vite?.close();
  dom?.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const invitation = 'https://example.invalid/party-test-invitation';
async function mount(t, isHost, status = 'open') {
  t.mock.method(QRCode, 'toDataURL', async () => 'data:image/png;base64,test');
  const calls = [];
  const room = { id: 'test', isHost, status, mode: 'auto', blockedReason: null, expiresAt: new Date(Date.now() + 60000).toISOString() };
  const client = { request: async path => {
    calls.push(path);
    if (path === '/rooms/test/invite') return { inviteUrl: invitation };
    assert.equal(path, '/rooms/test/requests');
    return { room, requests: [], nextCursor: null };
  } };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(h(ToastProvider, null, h(Room, {
    client, initialRoom: room, onRoomChange() {}, onReconnect() {},
  }))));
  return calls;
}

test('host invite starts collapsed and toggles without losing QR, invitation or copy functionality', async t => {
  const copied = [];
  t.mock.getter(globalThis, 'navigator', () => ({ clipboard: { writeText: async value => { copied.push(value); } } }));
  const calls = await mount(t, true);
  const details = container.querySelector('details');
  const summary = details.querySelector('summary');
  assert.equal(details.open, false);
  assert.equal(summary.textContent, 'Invite friends');
  await act(async () => summary.click());
  assert.equal(details.open, true);
  assert.match(details.querySelector('img').alt, /QR code.*Telegram/);
  assert.equal(details.querySelector('input').value, invitation);
  await act(async () => details.querySelector('button').click());
  assert.deepEqual(copied, [invitation]);
  assert.equal(details.querySelector('button').textContent, 'Copied!');
  await act(async () => summary.click());
  assert.equal(details.open, false);
  await act(async () => summary.click());
  assert.equal(details.open, true);
  assert.equal(details.querySelector('input').value, invitation);
  assert.equal(calls.filter(path => path.endsWith('/invite')).length, 1);
});

test('guests never render or request host invitations', async t => {
  const calls = await mount(t, false);
  assert.equal(container.querySelector('details'), null);
  assert.equal(container.querySelector('#party-invite-copy'), null);
  assert.doesNotMatch(container.textContent, /Invite friends|Copy invite/);
  assert.ok(calls.every(path => !path.endsWith('/invite')));
});

test('closed parties do not expose invitations even to hosts', async t => {
  const calls = await mount(t, true, 'closed');
  assert.equal(container.querySelector('details'), null);
  assert.ok(calls.every(path => !path.endsWith('/invite')));
  assert.match(container.textContent, /Party ended/);
});
