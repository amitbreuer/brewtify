import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { act, createElement as h } from 'react';

let vite, dom, createRoot, SongSearch, SongCard, ToastProvider, PartyError, root, container;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/app/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  vite = await createServer({
    configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom',
    ssr: { external: ['@brewtify/shared'] }, optimizeDeps: { noDiscovery: true },
    cacheDir: 'node_modules/.vite-song-search-tests',
  });
  ({ SongSearch } = await vite.ssrLoadModule('/src/features/party/SongSearch.tsx'));
  ({ SongCard } = await vite.ssrLoadModule('/src/features/party/SongCard.tsx'));
  ({ ToastProvider } = await vite.ssrLoadModule('/src/hooks/useToast.tsx'));
  ({ PartyError } = await vite.ssrLoadModule('/src/features/party/api.ts'));
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

const link = 'https://open.spotify.com/track/0123456789ABCDEFGHIJKL';
const other = 'https://music.apple.com/il/song/123456789';
const candidate = {
  id: '0123456789ABCDEFGHIJKL', title: 'Song', artist: 'Artist', album: 'Album',
  durationMs: 180000, explicit: false, url: link,
  artwork: 'https://i.scdn.co/image/test', evidence: ['direct_spotify_id'], selectionToken: 'signed-result',
};
const result = (candidates = [candidate]) => ({
  candidates, expiresAt: new Date(Date.now() + 300000).toISOString(),
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
async function mount(client) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  let props = { client, path: '/rooms/test', enabled: true, requests: [] };
  const render = async (changes = {}) => {
    props = { ...props, ...changes };
    await act(async () => root.render(h(ToastProvider, null, h(SongSearch, { ...props, key: props.path }))));
  };
  await render();
  return render;
}
async function input(value) {
  await act(async () => {
    const element = container.querySelector('input');
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
async function tick(t, ms) {
  await act(async () => t.mock.timers.tick(ms));
}
const choice = () => container.querySelector('.party-song-choice');
const toastCount = (text) => [...container.querySelectorAll('.animate-fade-in')].filter(element => element.textContent === text).length;
const receipt = (status, failureCode = null, id = 'own-request') => ({
  id, status, failureCode, selected: candidate, candidates: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

test('typing debounces complete links, invalid input and Enter never submit, shared card is reused', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = [];
  await mount({ request: async (path, body) => { calls.push({ path, body }); return result(); } });
  for (const partial of ['', 'https:', 'https://open.spotify.com/track/partial', 'https://music.apple.com/us/album/123']) {
    await input(partial);
    await tick(t, 1000);
  }
  assert.equal(calls.length, 0);
  await input(link);
  await tick(t, 499);
  assert.equal(calls.length, 0);
  await tick(t, 1);
  assert.deepEqual(calls, [{ path: '/rooms/test/search', body: { url: link } }]);
  assert.equal(choice().textContent, 'SongArtist · Album');
  assert.equal(choice().type, 'button');
  assert.equal(choice().querySelector('img').getAttribute('src'), candidate.artwork);
  await act(async () => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(calls.length, 1, 'Enter is not a queue action');
  const trackMarkup = choice().querySelector('.party-track').outerHTML;
  await act(async () => root.render(h(SongCard, { track: candidate })));
  assert.equal(container.querySelector('article .party-track').outerHTML, trackMarkup, 'list and result use identical track markup');
});

test('out-of-order results, failures and no-match toasts are invalidated on typing, room change and unmount', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = [];
  const render = await mount({ request: (path, body, signal) => {
    const response = deferred();
    calls.push({ path, body, signal, ...response });
    return response.promise;
  } });
  await input(link);
  await tick(t, 500);
  assert.match(container.textContent, /Searching/);
  await input(other);
  assert.equal(calls[0].signal.aborted, true);
  await tick(t, 500);
  await act(async () => calls[1].resolve(result([{ ...candidate, title: 'Current song' }])));
  await act(async () => calls[0].resolve(result([])));
  assert.match(choice().textContent, /Current song/);
  assert.equal(toastCount('Not found'), 0);
  const staleButton = choice();
  await input('https:');
  await act(async () => staleButton.click());
  assert.equal(calls.length, 2, 'detached stale candidates cannot enqueue');
  assert.equal(choice(), null);
  await input(link);
  await tick(t, 500);
  await render({ path: '/rooms/other' });
  assert.equal(calls[2].signal.aborted, true);
  await act(async () => calls[2].reject(new Error('Stale outage')));
  assert.doesNotMatch(container.textContent, /Stale outage/);
  await input(link);
  await tick(t, 500);
  await act(async () => root.unmount());
  root = undefined;
  assert.equal(calls[3].signal.aborted, true);
  await act(async () => calls[3].resolve(result([])));
  assert.equal(container.textContent, '');
});

test('one click submits directly, disables duplicates and only own confirmed receipt toasts once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const selected = deferred();
  const calls = [];
  const render = await mount({ request: (path, body) => {
    calls.push({ path, body });
    return path.endsWith('/search') ? Promise.resolve(result([candidate, { ...candidate, id: 'other', title: 'Other version' }])) : selected.promise;
  } });
  await input(link);
  await tick(t, 500);
  assert.equal(container.querySelectorAll('.party-song-choice').length, 2);
  assert.equal(calls.length, 1, 'multiple results never choose themselves');
  await act(async () => { choice().click(); choice().click(); });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { path: '/rooms/test/selections', body: { selectionToken: 'signed-result' } });
  assert.ok([...container.querySelectorAll('.party-song-choice')].every(button => button.disabled));
  assert.equal(toastCount('Added to the queue'), 0);
  await act(async () => selected.resolve({ id: 'own-request' }));
  assert.equal(container.querySelector('input').value, '');
  assert.equal(choice(), null);
  await render({ requests: [receipt('approved'), receipt('added', null, 'someone-else')] });
  assert.equal(toastCount('Added to the queue'), 0);
  assert.match(container.textContent, /Adding to Spotify/);
  await render({ requests: [receipt('added')] });
  assert.equal(toastCount('Added to the queue'), 1);
  assert.equal(container.querySelector('input').disabled, false);
  await render({ requests: [receipt('added')] });
  assert.equal(toastCount('Added to the queue'), 1);
  await tick(t, 4000);
  await render({ requests: [receipt('added')] });
  assert.equal(toastCount('Added to the queue'), 0);
  await render({ path: '/rooms/reloaded', requests: [receipt('added')] });
  assert.equal(toastCount('Added to the queue'), 0, 'history never replays success');
});

test('no-match toasts once per completed search; rate/auth/network failures remain failures', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let failure;
  let calls = 0;
  const render = await mount({ request: async () => {
    calls++;
    if (failure) throw failure;
    return result([]);
  } });
  await input(link);
  await tick(t, 500);
  assert.equal(toastCount('Not found'), 1);
  await render({ requests: [receipt('added', null, 'someone-else')] });
  await tick(t, 1000);
  assert.equal(calls, 1);
  assert.equal(toastCount('Not found'), 1);
  await tick(t, 4000);
  for (const error of [
    new PartyError('Busy', 'rate_limited', 429, 2000),
    new PartyError('Sign in again', 'session_expired', 401),
    new PartyError('Could not reach Party', 'network_error'),
  ]) {
    failure = error;
    await input(other);
    await tick(t, 500);
    assert.equal(toastCount('Not found'), 0);
    assert.ok(container.querySelector('[role=alert]'));
    if (error.status === 429) {
      assert.equal([...container.querySelectorAll('button')].find(button => button.textContent === 'Search again').disabled, true);
      await tick(t, 2000);
      assert.equal([...container.querySelectorAll('button')].find(button => button.textContent === 'Search again').disabled, false);
    }
    await input('');
  }
});

test('unknown and failed receipts never produce success, expired results cannot submit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const render = await mount({ request: async path => path.endsWith('/search') ? result() : { id: 'own-request' } });
  await input(link);
  await tick(t, 500);
  await act(async () => choice().click());
  await render({ requests: [receipt('failed', 'delivery_unknown')] });
  assert.equal(toastCount('Added to the queue'), 0);
  assert.match(container.textContent, /may already|unknown/i);
  await render({ path: '/rooms/new', requests: [] });
  await input(link);
  await tick(t, 500);
  await act(async () => choice().click());
  await render({ requests: [receipt('failed', 'device_unavailable')] });
  assert.equal(toastCount('Added to the queue'), 0);
  assert.match(container.textContent, /start playing music/);
  await render({ path: '/rooms/expired-result', requests: [] });
  await input(link);
  await tick(t, 500);
  await tick(t, 300000);
  assert.equal(choice(), null);
  assert.match(container.textContent, /search expired/i);
});

test('uncertain submission retries reuse the same capability; navigation ignores old submission responses', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const replies = [];
  const tokens = [];
  const render = await mount({ request: (path, body, signal) => {
    if (path.endsWith('/search')) return Promise.resolve(result());
    const response = deferred();
    replies.push({ ...response, signal });
    tokens.push(body.selectionToken);
    return response.promise;
  } });
  await input(link);
  await tick(t, 500);
  await act(async () => choice().click());
  await act(async () => replies[0].reject(new PartyError('Connection lost', 'network_error')));
  assert.equal(toastCount('Added to the queue'), 0);
  assert.match(container.textContent, /may already exist/);
  await act(async () => choice().click());
  assert.deepEqual(tokens, ['signed-result', 'signed-result']);
  await render({ path: '/rooms/new' });
  assert.equal(replies[1].signal.aborted, true);
  await act(async () => replies[1].resolve({ id: 'own-request' }));
  await render({ requests: [receipt('added')] });
  assert.equal(toastCount('Added to the queue'), 0);
  assert.equal(container.querySelector('input').disabled, false);
});
