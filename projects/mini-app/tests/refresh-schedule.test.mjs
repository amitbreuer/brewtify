import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { act, createElement as h, useState } from 'react';

let vite, dom, createRoot, RefreshSchedule, root, container;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/app/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  vite = await createServer({
    configFile: false, plugins: [react()], server: { middlewareMode: true, watch: null }, appType: 'custom',
    ssr: { external: ['@brewtify/shared'] }, optimizeDeps: { noDiscovery: true },
    cacheDir: 'node_modules/.vite-refresh-tests',
  });
  ({ RefreshSchedule } = await vite.ssrLoadModule('/src/components/RefreshSchedule.tsx'));
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

async function mount(initial) {
  const changes = [];
  function Editor() {
    const [schedule, setSchedule] = useState(initial);
    return h(RefreshSchedule, { schedule, onChange: value => { changes.push(value); setSchedule(value); } });
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(h(Editor)));
  return changes;
}
const toggle = () => container.querySelector('[role="switch"]');
const day = name => container.querySelector(`[aria-label="${name}"]`);
const click = async button => act(async () => button.click());

test('refresh switch saves None and restores the draft weekday selection', async () => {
  const changes = await mount('days:0,2,4');
  assert.equal(toggle().getAttribute('aria-checked'), 'true');
  assert.deepEqual([...container.querySelectorAll('[role="group"] button')].map(b => b.textContent), ['S','M','T','W','T','F','S']);
  await click(toggle());
  assert.equal(changes.at(-1), null);
  assert.equal(toggle().getAttribute('aria-checked'), 'false');
  assert.ok(day('Tuesday').disabled);
  assert.match(container.textContent, /None · Manual refresh only/);
  await click(toggle());
  assert.equal(changes.at(-1), 'days:0,2,4');
  await click(day('Thursday'));
  assert.equal(changes.at(-1), 'days:0,2');
  await click(day('Saturday'));
  assert.equal(changes.at(-1), 'days:0,2,6');
});

test('refresh keeps one day while enabled and uses switch for None', async () => {
  const changes = await mount('days:5');
  await click(day('Friday'));
  assert.equal(changes.length, 0);
  assert.match(container.textContent, /Use the switch/);
  await click(toggle());
  assert.equal(changes.at(-1), null);
});

test('refresh starts disabled for None and enables a valid weekday', async () => {
  const changes = await mount(null);
  assert.equal(toggle().getAttribute('aria-checked'), 'false');
  assert.ok(day('Sunday').disabled);
  await click(toggle());
  assert.match(changes.at(-1), /^days:[0-6]$/);
  assert.equal(toggle().getAttribute('aria-checked'), 'true');
});
