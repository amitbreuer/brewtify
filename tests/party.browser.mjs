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

test('interactive demo renders host, guest and setup with no API traffic', async () => {
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
  await page.getByLabel('Spotify or Apple Music song link', { exact: true }).fill('https://open.spotify.com/track/demo');
  await page.getByRole('button', { name: 'Add song', exact: true }).click();
  await page.getByRole('heading', { name: 'Your sample song', exact: true }).waitFor();
  assert.equal(await page.getByText('Added to host’s Spotify queue', { exact: true }).count(), 2);
  await page.getByRole('button', { name: 'Host setup', exact: true }).click();
  await page.getByLabel('Active Spotify device', { exact: true }).selectOption('living-room');
  await page.getByRole('button', { name: 'Create demo party', exact: true }).click();
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
    deviceId: 'speaker',
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
    else if (path.endsWith('/requests')) {
      if (http.method() === 'POST') {
        submission = { body: http.postDataJSON(), csrf: http.headers()['x-party-csrf'] };
        data = { id: 'new-song' };
      } else data = { room, requests: [request], nextCursor: '1' };
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
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/requests'));
  await page.getByRole('button', { name: 'Add song', exact: true }).click();
  await submitted;
  assert.equal(submission.csrf, 'test-csrf');
  assert.equal(submission.body.url, link);
  assert.match(submission.body.submissionKey, /^[a-f0-9-]{36}$/);
  assert.deepEqual(Object.keys(submission.body).sort(), ['submissionKey', 'url']);
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
