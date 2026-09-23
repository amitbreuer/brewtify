import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.PARTY_PREVIEW_URL ?? 'http://127.0.0.1:5197';
let browser;
before(async () => {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: 'chrome' }),
    headless: true,
    timeout: 20000,
  });
});
after(async () => {
  await browser?.close();
});

async function previewPage(options) {
  const page = await browser.newPage(options);
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' })
  );
  return page;
}

test('interactive demo renders host, guest and direct start with no API traffic', async () => {
  const page = await previewPage({ viewport: { width: 390, height: 844 } });
  const requests = [];
  const errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/app/?section=party&demo=host`);
  await page.getByText('INTERACTIVE PREVIEW', { exact: true }).waitFor();
  const afterglow = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Afterglow', exact: true }) });
  await afterglow.waitFor();
  assert.equal(await afterglow.getByRole('heading').evaluate(element => getComputedStyle(element).color), 'rgb(255, 255, 255)');
  assert.deepEqual((await afterglow.innerText()).split('\n').filter(Boolean), ['Afterglow', 'Northern Lines · Blue Hour']);
  assert.equal(await page.getByRole('article').getByRole('link').count(), 0);
  assert.equal(await page.getByText('Added to host’s Spotify queue', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Your party', exact: true }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Party', exact: true }).count(), 0);
  assert.equal(await page.getByText('Song links only. No music account needed.', { exact: true }).count(), 0);
  const endParty = page.getByRole('button', { name: 'End party', exact: true });
  assert.equal(await endParty.innerText(), '');
  const endSize = await endParty.boundingBox();
  assert.equal(endSize.width, 44);
  assert.equal(endSize.height, 44);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const rowSize = await afterglow.boundingBox();
    assert.ok(rowSize.height <= 80, `Song row is too tall: ${rowSize.height}`);
    const artworkSize = await afterglow.locator('img').boundingBox();
    assert.equal(artworkSize.width, 48);
    assert.equal(artworkSize.height, 48);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByRole('button', { name: /Approve|Reject|Lock requests|Disconnect Party Spotify|Confirm playback device/ }).count(), 0);
  assert.equal(await page.getByLabel('Moderation mode', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Display name', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Guest view', exact: true }).click();
  await page.getByRole('heading', { name: 'Your songs', exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 1);
  assert.equal(await page.getByRole('textbox').count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Party', exact: true }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'You’re invited', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'End party', exact: true }).count(), 0);
  assert.equal(await page.locator('form').evaluate(element => element.previousElementSibling === null), true);
  const sunrise = page.getByRole('article');
  assert.deepEqual((await sunrise.innerText()).split('\n').filter(Boolean), ['Sunrise Again', 'Sunday Club · Slow Mornings']);
  assert.equal(await sunrise.getByRole('link').count(), 0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok((await sunrise.boundingBox()).height <= 80);
    assert.equal((await sunrise.locator('img').boundingBox()).width, 48);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByText('Song links only. No music account needed.', { exact: true }).count(), 0);
  await page.getByLabel('Spotify or Apple Music song link', { exact: true }).fill('https://open.spotify.com/track/0123456789ABCDEFGHIJKL');
  const result = page.getByRole('button', { name: 'Afterglow Northern Lines · Blue Hour', exact: true });
  await result.waitFor();
  assert.equal(await page.getByRole('article').count(), 1, 'search does not add a song');
  assert.equal((await result.locator('img').boundingBox()).width, 48);
  assert.ok((await result.boundingBox()).height <= 80);
  await result.click();
  await page.getByText('Added to the queue', { exact: true }).waitFor();
  await page.getByRole('article').getByRole('heading', { name: 'Afterglow', exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 2);
  assert.equal(await page.getByText('Added to host’s Spotify queue', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Start screen', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Host setup', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Active Spotify device', { exact: true }).count(), 0);
  await page.getByRole('checkbox', { name: 'I have Spotify Premium and will host playback.' }).check();
  await page.getByRole('button', { name: 'Start party', exact: true }).click();
  await page.getByRole('button', { name: 'End party', exact: true }).waitFor();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'End party', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Add a song', exact: true }).count(), 1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'End party', exact: true }).click();
  await page.getByText('Party ended.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'End party', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Add song', exact: true }).count(), 0);
  assert.equal(requests.some(url => new URL(url).pathname.startsWith('/api/')), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('mobile Party opens without Library requests or unsigned authentication', async () => {
  const page = await previewPage({ viewport: { width: 390, height: 844 } });
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app/?section=party`);
  await page
    .getByRole('heading', { name: /Open Party in Telegram/i })
    .waitFor();
  assert.equal(
    requests.some((url) => /\/profile(?:\?|$)/.test(url)),
    false
  );
  assert.equal(
    requests.some((url) => url.endsWith('/api/party/session')),
    false
  );
  assert.equal(
    await page.getByRole('button', { name: /Library$/ }).isVisible(),
    true
  );
  assert.equal(
    await page.getByRole('button', { name: /Party$/ }).isVisible(),
    true
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  assert.deepEqual(errors, []);
  await page.close();
});

test('host and guest search cards match list dimensions, select with keyboard and distinguish no-match from errors', async () => {
  for (const role of ['host', 'guest']) {
    const page = await previewPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${base}/app/?section=party&demo=${role}`);
      const input = page.getByLabel('Spotify or Apple Music song link', { exact: true });
      await page.getByLabel('Search / delivery sample').selectOption('multiple');
      await input.fill('https://music.apple.com/us/song/123456789');
      const results = page.locator('.party-song-choice');
      await results.nth(1).waitFor();
      assert.equal(await results.count(), 2);
      const before = await page.getByRole('article').count();
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal((await results.first().locator('img').boundingBox()).width, 48);
        assert.equal((await results.first().locator('img').boundingBox()).height, 48);
        assert.ok((await results.first().boundingBox()).height <= 80);
        assert.equal(await results.first().locator('h3').evaluate(element => getComputedStyle(element).fontSize),
          await page.getByRole('article').first().locator('h3').evaluate(element => getComputedStyle(element).fontSize));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      }
      assert.equal(await page.getByRole('article').count(), before);
      assert.equal(await page.getByText('Added to the queue', { exact: true }).count(), 0);
      await results.first().focus();
      await results.first().press('Enter');
      await page.getByText('Added to the queue', { exact: true }).waitFor();
      assert.equal(await page.getByRole('article').count(), before + 1);
      for (const scenario of ['not_found', 'rate_limited', 'unknown']) {
        await page.getByLabel('Search / delivery sample').selectOption(scenario);
        await input.fill('https://music.apple.com/us/song/123456789');
        if (scenario === 'not_found') {
          await page.getByText('Not found', { exact: true }).waitFor();
          assert.equal(await results.count(), 0);
          await page.getByText('Not found', { exact: true }).waitFor({ state: 'hidden' });
        } else if (scenario === 'rate_limited') {
          await page.getByRole('alert').getByText(/Too many requests/).waitFor();
          assert.equal(await page.getByText('Not found', { exact: true }).count(), 0);
        } else {
          await results.first().click();
          await page.getByText(/Outcome unknown/).first().waitFor();
          assert.equal(await page.getByText('Added to the queue', { exact: true }).count(), 0);
        }
      }
    } finally { await page.close(); }
  }
});

test('Library loading and errors never hide Party navigation', async () => {
  const page = await previewPage({
    viewport: { width: 1280, height: 800 },
  });
  let release;
  await page.route('**/profile', async (route) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Library test outage' }),
    });
  });
  await page.goto(`${base}/app/?section=library`);
  await page.getByRole('button', { name: /Party$/ }).waitFor();
  await page.getByRole('button', { name: /Party$/ }).click();
  await page
    .getByRole('heading', { name: /Open Party in Telegram/i })
    .waitFor();
  release?.();
  await page.getByRole('button', { name: /Library$/ }).click();
  await page.getByRole('button', { name: /Party$/ }).click();
  await page
    .getByRole('heading', { name: /Open Party in Telegram/i })
    .waitFor();
  await page.reload();
  await page
    .getByRole('heading', { name: /Open Party in Telegram/i })
    .waitFor();
  await page.close();
});

test('disabled feature preserves Library-only navigation', async () => {
  const page = await previewPage();
  await page.route('**/api/party/config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: false,
        telegramUrl: null,
        autoEnabled: false,
      }),
    })
  );
  await page.route('**/profile', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":"login required"}',
    })
  );
  await page.goto(`${base}/app/?section=party`);
  await page.waitForFunction(
    () => !!document.querySelector('#root')?.textContent?.trim()
  );
  assert.equal(await page.getByRole('button', { name: /Party$/ }).count(), 0);
  await page.close();
});

test('recording confirmation and nameless submissions retain the Party CSRF contract', async () => {
  const page = await previewPage({ viewport: { width: 390, height: 844 } });
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  const room = {
    id: 'fixture-room',
    status: 'open',
    mode: 'host_approval',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    blockedReason: null,
    isHost: true,
  };
  const request = {
    id: 'fixture-request',
    displayName: 'Guest',
    sourceUrl: 'https://open.spotify.com/track/0123456789ABCDEFGHIJKL',
    selected: {
      id: '0123456789ABCDEFGHIJKL',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      durationMs: 180000,
      explicit: false,
      url: 'https://open.spotify.com/track/0123456789ABCDEFGHIJKL',
      evidence: ['exact'],
    },
    candidates: [],
    confidence: 'exact',
    status: 'matched',
    failureCode: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let approval;
  let submission;
  let search;
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "window.Telegram={WebApp:{initData:'browser-test-fixture-not-valid-server-auth',ready(){},expand(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}},onEvent(){},offEvent(){}}};",
    })
  );
  await page.route('**/api/party/**', async (route) => {
    const http = route.request();
    const path = new URL(http.url()).pathname;
    let data;
    if (path.endsWith('/config'))
      data = { enabled: true, telegramUrl: null, autoEnabled: false };
    else if (path.endsWith('/session'))
      data = { csrfToken: 'test-csrf', hostConnected: true, room };
    else if (path.endsWith('/auth/status')) data = { status: 'idle' };
    else if (path.endsWith('/invite'))
      data = {
        inviteUrl: `https://t.me/test_party_bot?startapp=p_${'a'.repeat(43)}`,
      };
    else if (path.endsWith('/requests')) data = { room, requests: [request], nextCursor: '1' };
    else if (path.endsWith('/search')) {
      search = { body: http.postDataJSON(), csrf: http.headers()['x-party-csrf'] };
      data = { candidates: [{ ...request.selected, selectionToken: 'signed-fixture' }], expiresAt: new Date(Date.now() + 300000).toISOString() };
    } else if (path.endsWith('/selections')) {
      submission = { body: http.postDataJSON(), csrf: http.headers()['x-party-csrf'] };
      data = { id: 'new-song' };
    }
    else if (path.endsWith('/action')) {
      approval = {
        body: http.postDataJSON(),
        csrf: http.headers()['x-party-csrf'],
      };
      request.status = 'approved';
      request.updatedAt = new Date(Date.now() + 1).toISOString();
      data = { ok: true };
    } else throw new Error(`Unexpected Party API request ${path}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  await page.goto(`${base}/app/?section=party`);
  await page.getByRole('button', { name: 'Add this recording', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add this recording', exact: true })
    .waitFor({ state: 'hidden' });
  assert.deepEqual(approval, {
    body: { action: 'approve' },
    csrf: 'test-csrf',
  });
  const link = 'https://open.spotify.com/track/0123456789ABCDEFGHIJKL';
  await page.getByLabel('Spotify or Apple Music song link', { exact: true }).fill(link);
  const result = page.getByRole('button', { name: 'Song Artist · Album', exact: true });
  await result.waitFor();
  assert.deepEqual(search, { body: { url: link }, csrf: 'test-csrf' });
  assert.equal(submission, undefined);
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/selections'));
  await result.click();
  await submitted;
  assert.equal(submission.csrf, 'test-csrf');
  assert.deepEqual(submission.body, { selectionToken: 'signed-fixture' });
  assert.equal(await page.getByText('Added to the queue', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('img', { name: /QR/i }).count(), 1);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  assert.deepEqual(failures, []);
  await page.close();
});

test('hosts go from authorization directly to a room, resume safely, and can retry a failed creation', async () => {
  for (const scenario of ['new-host', 'authorization-complete', 'already-connected', 'reconnect', 'creation-failure', 'authorization-failure']) {
    const page = await previewPage({ viewport: { width: 390, height: 844 } });
    try {
      const roomFixture = { id: 'start-room', status: 'open', mode: 'auto', expiresAt: new Date(Date.now() + 3600000).toISOString(), blockedReason: null, isHost: true };
      let connected = ['authorization-complete', 'already-connected', 'reconnect', 'creation-failure'].includes(scenario);
      let room = scenario === 'reconnect' ? { ...roomFixture, blockedReason: 'unauthorized' } : null;
      let auth = scenario === 'authorization-complete' ? 'complete' : 'idle';
      let creations = 0;
      let authorizations = 0;
      const unexpected = [];
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        contentType: 'text/javascript',
        body: "window.Telegram={WebApp:{initData:'browser-fixture-not-valid-auth',ready(){},expand(){},openLink(url){window.openedOAuth=url},BackButton:{show(){},hide(){},onClick(){},offClick(){}},onEvent(){},offEvent(){}}};",
      }));
      await page.route('**/api/party/**', async route => {
        const http = route.request();
        const path = new URL(http.url()).pathname;
        let status = 200;
        let data;
        if (http.method() === 'POST') assert.equal(http.headers()['x-party-csrf'], 'start-csrf');
        if (path.endsWith('/config')) data = { enabled: true, autoEnabled: true, telegramUrl: null };
        else if (path.endsWith('/session')) data = { csrfToken: 'start-csrf', hostConnected: connected, room };
        else if (path.endsWith('/auth/status')) data = { status: auth, ...(auth === 'failed' ? { error: 'authorization_cancelled' } : {}) };
        else if (path.endsWith('/auth/start')) {
          assert.deepEqual(http.postDataJSON(), { premiumConfirmed: true });
          authorizations++;
          auth = scenario === 'authorization-failure' ? 'failed' : 'complete';
          connected = auth === 'complete';
          if (room) room.blockedReason = null;
          data = { authorizationUrl: 'https://example.invalid/test-oauth' };
        } else if (path.endsWith('/rooms')) {
          assert.deepEqual(http.postDataJSON(), {});
          creations++;
          room = roomFixture;
          if (scenario === 'creation-failure' && creations === 1) {
            status = 503;
            data = { error: { code: 'party_unavailable', message: 'Temporary creation failure' } };
          } else data = { room, inviteUrl: 'https://example.invalid/invite' };
        } else if (path.endsWith('/invite')) data = { inviteUrl: 'https://example.invalid/invite' };
        else if (path.endsWith('/requests')) data = { room, requests: [], nextCursor: '1' };
        else {
          unexpected.push(path);
          status = 500;
          data = { error: { code: 'unexpected', message: path } };
        }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto(`${base}/app/?section=party`);
      if (scenario === 'new-host' || scenario === 'authorization-failure') {
        await page.getByRole('checkbox', { name: 'I have Spotify Premium and will host playback.' }).check();
        await page.getByRole('button', { name: 'Start party', exact: true }).click();
      } else if (scenario === 'reconnect') {
        await page.getByRole('button', { name: 'Reconnect Spotify', exact: true }).click();
      } else if (scenario === 'creation-failure') {
        await page.getByRole('alert').getByText('Temporary creation failure', { exact: true }).waitFor();
        await page.waitForTimeout(3200);
        assert.equal(creations, 1, 'room creation failure must not become an automatic mutation retry loop');
        await page.getByRole('button', { name: 'Start party', exact: true }).click();
      }
      if (scenario === 'authorization-failure') {
        await page.getByRole('alert').getByText('authorization cancelled', { exact: true }).waitFor();
        assert.equal(creations, 0);
      } else {
        await page.getByRole('button', { name: 'End party', exact: true }).waitFor();
        assert.equal(creations, scenario === 'reconnect' ? 0 : scenario === 'creation-failure' ? 2 : 1, scenario);
        await page.reload();
        await page.getByRole('button', { name: 'End party', exact: true }).waitFor();
        assert.equal(creations, scenario === 'reconnect' ? 0 : scenario === 'creation-failure' ? 2 : 1, 'reloading an active party must not recreate it');
      }
      assert.equal(authorizations, ['new-host', 'reconnect', 'authorization-failure'].includes(scenario) ? 1 : 0);
      assert.equal(await page.getByRole('heading', { name: 'Host setup', exact: true }).count(), 0);
      assert.equal(await page.getByRole('combobox').count(), 0);
      assert.deepEqual(unexpected, [], 'no device endpoint or other unexpected request');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test('playback-unavailable recovery is an explicit host action without device selection', async () => {
  const page = await previewPage();
  try {
    const room = { id: 'recovery-room', status: 'open', mode: 'auto', expiresAt: new Date(Date.now() + 3600000).toISOString(), blockedReason: 'device_unavailable', isHost: true };
    let actions = 0;
    const unexpected = [];
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
      contentType: 'text/javascript',
      body: "window.Telegram={WebApp:{initData:'browser-fixture-not-valid-auth',ready(){},expand(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}},onEvent(){},offEvent(){}}};",
    }));
    await page.route('**/api/party/**', async route => {
      const http = route.request();
      const path = new URL(http.url()).pathname;
      let data;
      if (path.endsWith('/config')) data = { enabled: true, autoEnabled: true, telegramUrl: null };
      else if (path.endsWith('/session')) data = { csrfToken: 'retry-csrf', hostConnected: true, room };
      else if (path.endsWith('/auth/status')) data = { status: 'idle' };
      else if (path.endsWith('/invite')) data = { inviteUrl: 'https://example.invalid/invite' };
      else if (path.endsWith('/requests')) data = { room, requests: [], nextCursor: '1' };
      else if (path.endsWith('/action')) {
        assert.equal(http.headers()['x-party-csrf'], 'retry-csrf');
        assert.deepEqual(http.postDataJSON(), { action: 'resume_playback' });
        actions++;
        room.blockedReason = null;
        data = { ok: true };
      } else { unexpected.push(path); data = {}; }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(`${base}/app/?section=party`);
    await page.getByText(/start playing music, then tap Try again/).waitFor();
    assert.equal(actions, 0);
    assert.equal(await page.getByRole('combobox').count(), 0);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(actions, 1);
    assert.deepEqual(unexpected, []);
  } finally { await page.close(); }
});
