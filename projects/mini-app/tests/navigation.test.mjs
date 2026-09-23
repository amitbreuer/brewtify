import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialNavigation, inviteSecret, mergeFeed, retryDelay, sectionUrl } from '../src/lib/navigation.ts';

const secret = 'a'.repeat(43);

test('normal launches retain Library; Party query and Telegram launches are reload-safe', () => {
  assert.deepEqual(initialNavigation(''), { section: 'library', secret: null });
  assert.equal(initialNavigation('?section=party').section, 'party');
  assert.equal(initialNavigation('?startapp=party').section, 'party');
  assert.equal(initialNavigation('?tgWebAppStartParam=party').section, 'party');
  assert.deepEqual(initialNavigation('', `start_param=p_${secret}`), { section: 'party', secret });
  assert.equal(initialNavigation('?section=library', 'start_param=party').section, 'library');
  assert.equal(initialNavigation('?startapp=unknown').section, 'library');
});

test('navigation consumes launch routing without losing unrelated query or hash context', () => {
  const url = sectionUrl(`https://example.com/app?startapp=p_${secret}&tgWebAppStartParam=party&x=1#fragment`, 'library');
  assert.equal(url, '/app?x=1&section=library#fragment');
  assert.equal(initialNavigation(new URL(url, 'https://example.com').search, 'start_param=party').section, 'library');
  assert.equal(initialNavigation(new URL(sectionUrl(`https://example.com${url}`, 'party'), 'https://example.com').search).section, 'party');
});

test('invitations accept only bounded capabilities or Telegram deep links', () => {
  assert.equal(inviteSecret(secret), secret);
  assert.equal(inviteSecret(`p_${secret}`), secret);
  assert.equal(inviteSecret(`https://t.me/real_bot?startapp=p_${secret}`), secret);
  for (const value of ['', 'p_short', `https://evil.test/?startapp=p_${secret}`, `https://t.me.evil.test/?startapp=p_${secret}`, `https://user@t.me/bot?startapp=p_${secret}`, 'x'.repeat(100)]) {
    assert.equal(inviteSecret(value), null, value);
  }
});

test('changed request feed merges by id, preserves receipts, and ignores stale races', () => {
  const first = { id: 'a', createdAt: '2026-01-01', updatedAt: '2026-01-02', status: 'pending' };
  const changed = { ...first, updatedAt: '2026-01-03', status: 'added' };
  const other = { id: 'b', createdAt: '2026-01-02', updatedAt: '2026-01-02', status: 'matched' };
  const merged = mergeFeed([first, other], [changed]);
  assert.deepEqual(merged, [changed, other]);
  assert.deepEqual(mergeFeed(merged, [first]), [changed, other]);
});

test('polling backoff is bounded but never shortens Retry-After', () => {
  assert.equal(retryDelay(0), 3000);
  assert.equal(retryDelay(1), 6000);
  assert.equal(retryDelay(100), 60_000);
  assert.equal(retryDelay(1, 120_000), 120_000);
});

test('shell keeps Library authentication and data imports behind a lazy feature boundary', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const library = await readFile(new URL('../src/features/library/Library.tsx', import.meta.url), 'utf8');
  const party = await readFile(new URL('../src/features/party/Party.tsx', import.meta.url), 'utf8');
  assert.match(app, /lazy\(\(\) => import\('\.\/features\/library\/Library'\)\)/);
  assert.doesNotMatch(app, /fetchProfile|lib\/api|initDataUnsafe|VITE_TELEGRAM_USER_ID/);
  assert.match(app, /config\.enabled && section === 'party'/);
  assert.match(app, /config\.enabled && \(\s*<nav/);
  assert.match(app, /<LibraryErrorBoundary partyEnabled=\{config\.enabled\}><Library partyEnabled=\{config\.enabled\} \/><\/LibraryErrorBoundary>/);
  assert.ok(app.indexOf('</LibraryErrorBoundary>') < app.indexOf('<nav'), 'The Library render boundary must not wrap section navigation');
  assert.match(library, /fetchProfile\(\)/);
  assert.match(library, /if \(view === 'login'\)/);
  assert.match(library, /if \(view === 'error'\)/);
  assert.doesNotMatch(party, /fetchProfile|lib\/api|initDataUnsafe|VITE_TELEGRAM_USER_ID/);
  assert.match(party, /if \(!initData\) return/);
});

test('development optimizes the linked CommonJS shared workspace for browser imports', async () => {
  const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(config, /optimizeDeps:\s*\{\s*include:\s*\['@brewtify\/shared'\]/);
});
