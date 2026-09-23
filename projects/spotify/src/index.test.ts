import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import type { PartyCandidate } from '@brewtify/shared';
import {
  PARTY_SPOTIFY_SCOPES, PROVIDER_BODY_LIMIT, PROVIDER_DEADLINE_MS,
  assertSelectedRecording, assertTrackEligible, buildSpotifyAuthorizationUrl, providerRequest,
  SpotifyClient, SpotifyError, trackEligibility, type SpotifyTrack,
} from './index';

const ID = '0123456789ABCDEFGHIJKL';
const OTHER = 'ABCDEFGHIJKLMNOPQRSTUV';
const client = () => new SpotifyClient({ clientId: 'test-client', redirectUri: 'https://example.org/party/callback' });
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
const track = (): SpotifyTrack => ({
  id: ID, name: 'Song', artists: [{ name: 'Artist' }], album: { name: 'Album' },
  duration_ms: 200_000, explicit: false, is_playable: true,
});

test('shared authorization builder preserves legacy scope configuration and exact parameter serialization', () => {
  const scopes = [
    'user-read-private', 'user-read-email', 'playlist-read-private', 'playlist-modify-private',
    'playlist-modify-public', 'user-follow-read', 'user-follow-modify',
  ];
  for (const state of ['', 'telegram-user:123', 'state+with&reserved=characters /?']) {
    const clientId = 'legacy+client';
    const redirectUri = 'http://127.0.0.1:5173/callback?source=library&next=/app';
    const expected = `https://accounts.spotify.com/authorize?${new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: scopes.join(' '), state,
    })}`;
    const actual = buildSpotifyAuthorizationUrl({ clientId, redirectUri, scopes, state });
    assert.equal(actual, expected);
    const params = new URL(actual).searchParams;
    assert.deepEqual(params.get('scope')?.split(' '), scopes);
    assert.equal(params.get('state'), state);
    assert.equal(params.has('code_challenge'), false);
    assert.equal(params.has('code_challenge_method'), false);
    assert.equal(params.get('scope')?.includes('playback'), false);
  }
});

test('PKCE authorization requests only playback scopes', () => {
  assert.deepEqual(PARTY_SPOTIFY_SCOPES, ['user-modify-playback-state']);
  const url = new URL(client().authorizationUrl({ state: 'random-state', codeChallenge: 'a'.repeat(43) }));
  assert.equal(url.origin, 'https://accounts.spotify.com');
  assert.equal(url.searchParams.get('scope'), PARTY_SPOTIFY_SCOPES.join(' '));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.org/party/callback');
  assert.equal(url.searchParams.get('state'), 'random-state');
  assert.throws(() => client().authorizationUrl({ state: 'x', codeChallenge: 'bad' }), SpotifyError);
  assert.throws(() => new SpotifyClient({ clientId: 'x', redirectUri: 'http://evil.example' }), SpotifyError);
});

test('PKCE exchange and refresh preserve rotated credentials without client secret', async t => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: url.toString(), init });
    return json({ access_token: 'access', refresh_token: 'rotated', expires_in: 3600, scope: 'user-modify-playback-state' });
  });
  const tokens = await client().exchange('code', 'v'.repeat(43));
  assert.deepEqual(tokens, { accessToken: 'access', refreshToken: 'rotated', expiresIn: 3600, scopes: [...PARTY_SPOTIFY_SCOPES] });
  await client().refresh('old-refresh');
  assert.equal(calls[0].url, 'https://accounts.spotify.com/api/token');
  const first = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(first.get('code_verifier'), 'v'.repeat(43));
  assert.equal(first.has('client_secret'), false);
  assert.equal(new URLSearchParams(String(calls[1].init?.body)).get('refresh_token'), 'old-refresh');
  assert.equal(calls.length, 2);
});

test('204 enqueue is one POST with query parameters and no JSON decoding', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    count++;
    assert.equal(url.origin, 'https://api.spotify.com');
    assert.equal(url.pathname, '/v1/me/player/queue');
    assert.equal(url.searchParams.get('uri'), `spotify:track:${ID}`);
    assert.equal(url.searchParams.get('device_id'), 'speaker');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'manual');
    assert.ok((init as RequestInit & { dispatcher?: unknown }).dispatcher);
    assert.equal(init?.body, undefined);
    assert.ok(init?.signal);
    const response = new Response(null, { status: 204 });
    response.json = async () => { throw new Error('Must not decode 204'); };
    return response;
  });
  await client().enqueue('token', ID, 'speaker');
  assert.equal(count, 1);
});

test('enqueue uses active playback when device ID is omitted and rejects invalid explicit targets', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.pathname, '/v1/me/player/queue');
    assert.equal(url.searchParams.has('device_id'), false);
    assert.equal(url.searchParams.get('uri'), `spotify:track:${ID}`);
    assert.equal(init?.method, 'POST');
    return new Response(null, { status: 204 });
  });
  await client().enqueue('token', ID);
  for (const device of ['', 'bad device', 'x'.repeat(257)]) {
    await assert.rejects(client().enqueue('token', ID, device), { code: 'invalid_input' });
  }
  await assert.rejects(client().enqueue('token', 'invalid'), { code: 'invalid_input' });
  assert.equal(calls, 1);
});

test('every queue error performs exactly one write, with explicit uncertainty classification', async t => {
  const cases: { status?: number; body?: unknown; code: string; unknown: boolean }[] = [
    { status: 429, body: { error: { message: 'rate limited' } }, code: 'rate_limited', unknown: false },
    { status: 500, body: {}, code: 'provider_unavailable', unknown: true },
    { status: 503, body: {}, code: 'provider_unavailable', unknown: true },
    { status: 401, body: {}, code: 'unauthorized', unknown: false },
    { status: 403, body: { error: { reason: 'PREMIUM_REQUIRED' } }, code: 'premium_required', unknown: false },
    { status: 403, body: { error: { message: 'Insufficient client scope' } }, code: 'insufficient_scope', unknown: false },
    { status: 403, body: { error: { message: 'App not allowed' } }, code: 'forbidden', unknown: false },
    { status: 404, body: {}, code: 'device_unavailable', unknown: false },
    { status: 400, body: {}, code: 'provider_rejected', unknown: false },
    { status: 302, body: {}, code: 'redirect_rejected', unknown: true },
    { status: 200, body: {}, code: 'invalid_response', unknown: true },
    { code: 'network', unknown: true },
  ];
  for (const fixture of cases) {
    await t.test(fixture.code + ':' + fixture.status, async child => {
      let calls = 0;
      child.mock.method(globalThis, 'fetch', async () => {
        calls++;
        if (fixture.status === undefined) throw new TypeError('connection reset');
        return json(fixture.body, fixture.status, { 'Retry-After': '23', Location: 'http://127.0.0.1' });
      });
      await assert.rejects(client().enqueue('token', ID), (error: unknown) => {
        assert.ok(error instanceof SpotifyError);
        assert.equal(error.code, fixture.code);
        assert.equal(error.unknownDelivery, fixture.unknown);
        if (fixture.status === 429) assert.equal(error.retryAfterSeconds, 23);
        return true;
      });
      assert.equal(calls, 1);
    });
  }
});

test('429 with HTML response still schedules durable retry, never sleeps/retries', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('<html>rate limited</html>', { status: 429, headers: { 'Retry-After': '7' } });
  });
  await assert.rejects(client().enqueue('token', ID, 'speaker'), (error: unknown) =>
    error instanceof SpotifyError && error.code === 'rate_limited' && error.retryAfterSeconds === 7 && !error.unknownDelivery);
  assert.equal(calls, 1);
});

test('read transport failures do not imply queue uncertainty and do not hide outages', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('DNS failure'); });
  await assert.rejects(client().track('token', ID), (error: unknown) =>
    error instanceof SpotifyError && error.code === 'network' && !error.unknownDelivery);
});

test('deadline aborts a stalled queue request as unknown without repeating it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', (_url: Parameters<typeof fetch>[0], init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('deadline')), { once: true });
  }));
  const pending = client().enqueue('token', ID, 'speaker');
  const assertion = assert.rejects(pending, (error: unknown) =>
    error instanceof SpotifyError && error.code === 'network' && error.unknownDelivery
      && error.diagnostics.phase === 'request' && error.diagnostics.transportCode === 'deadline_exceeded');
  t.mock.timers.tick(PROVIDER_DEADLINE_MS);
  await assertion;
});

test('deadline also covers stalled response body consumption', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls++;
    return new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new Error('body deadline')), { once: true });
      },
    }));
  });
  const assertion = assert.rejects(client().profile('token'), (error: unknown) =>
    error instanceof SpotifyError && error.code === 'network' && !error.unknownDelivery);
  await Promise.resolve();
  t.mock.timers.tick(PROVIDER_DEADLINE_MS);
  await assertion;
  assert.equal(calls, 1);
});

test('429 body failures/oversize retain explicit rejection and Retry-After', async t => {
  for (const oversized of [false, true]) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(
      oversized ? 'oversized' : new ReadableStream({ start(controller) { controller.error(new Error('broken body')); } }),
      { status: 429, headers: { 'Retry-After': '19', ...(oversized ? { 'Content-Length': String(PROVIDER_BODY_LIMIT + 1) } : {}) } },
    ));
    await assert.rejects(client().enqueue('token', ID, 'speaker'), (error: unknown) =>
      error instanceof SpotifyError && error.code === 'rate_limited' && error.retryAfterSeconds === 19 && !error.unknownDelivery);
    mocked.mock.restore();
  }
});

test('Retry-After supports HTTP dates and defaults safely on invalid/absent values', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T00:00:00Z') });
  for (const [value, seconds] of [['Thu, 01 Jan 2026 00:00:30 GMT', 30], ['bad', 60], ['', 60]] as const) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => json({}, 429, { 'Retry-After': value }));
    await assert.rejects(client().enqueue('token', ID, 'speaker'), (error: unknown) =>
      error instanceof SpotifyError && error.retryAfterSeconds === seconds && !error.unknownDelivery);
    mocked.mock.restore();
  }
});

test('fixed origins and redirect rejection prevent arbitrary destinations', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls++;
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } });
  });
  await assert.rejects(providerRequest('itunes', 'lookup?id=123&country=us', {}), /redirect_rejected/);
  await assert.rejects(providerRequest('itunes', 'https://api.music.apple.com/v1/catalog/us/songs/123', {}), /invalid_response/);
  await assert.rejects(providerRequest('itunes', '//127.0.0.1/lookup?id=123', {}), /invalid_response/);
  await assert.rejects(providerRequest('spotify', 'https://evil.example/', {}), /invalid_response/);
  await assert.rejects(providerRequest('spotify', '//127.0.0.1/', {}), /invalid_response/);
  await assert.rejects(providerRequest('spotify', '../../other', {}), /invalid_response/);
  assert.equal(calls, 1);
});

test('response bodies bounded by declared and streamed length; malformed JSON rejected', async t => {
  for (const kind of ['declared', 'streamed', 'json']) {
    await t.test(kind, async child => {
      child.mock.method(globalThis, 'fetch', async () => new Response(
        kind === 'streamed' ? 'x'.repeat(PROVIDER_BODY_LIMIT + 1) : 'not-json',
        { headers: kind === 'declared' ? { 'Content-Length': String(PROVIDER_BODY_LIMIT + 1) } : undefined },
      ));
      await assert.rejects(client().profile('token'), (error: unknown) =>
        error instanceof SpotifyError && error.code === 'invalid_response');
    });
  }
});

test('minimal profile, devices, bounded search, market/relinking evidence preserved', async t => {
  const responses = [
    { id: 'host' },
    { devices: [{ id: 'speaker', name: 'Speaker', is_active: true, is_restricted: false }, { id: null }] },
    { ...track(), linked_from: { id: OTHER }, restrictions: { reason: 'market' } },
    { tracks: { items: [track()] } },
  ];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('market'),
      url.pathname.includes('/tracks/') ? 'from_token' : null);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token');
    if (url.pathname.endsWith('/search')) assert.equal(url.searchParams.get('limit'), '10');
    return json(responses.shift());
  });
  assert.deepEqual(await client().profile('token'), { id: 'host' });
  assert.deepEqual(await client().devices('token'), [{ id: 'speaker', name: 'Speaker', isActive: true, isRestricted: false }]);
  const result = await client().track('token', ID);
  assert.deepEqual(result.linked_from, { id: OTHER });
  assert.deepEqual(result.restrictions, { reason: 'market' });
  assert.equal(result.is_playable, true);
  assert.equal((await client().search('token', 'isrc:USABC1234567')).length, 1);
});

test('search avoids from_token scope rejection while direct metadata retains host-market evidence', async t => {
  for (const recording of [
    { ...track(), name: 'Tron', artists: [{ name: 'Foals' }], album: { name: 'Antidotes' },
      duration_ms: 290840, external_ids: { isrc: 'GBVKZ0725315' } },
    { ...track(), name: 'Freaking Out the Neighborhood', artists: [{ name: 'Mac DeMarco' }],
      album: { name: '2' }, duration_ms: 173888, external_ids: { isrc: 'QMMZN1200048' } },
  ]) {
    const calls: URL[] = [];
    const mocked = t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith('/search')) return url.searchParams.has('market')
        ? json({ error: { message: 'Insufficient client scope' } }, 403)
        : json({ tracks: { items: [recording] } });
      // Without market, track metadata omits the positive playability evidence.
      return json({ ...recording, is_playable: url.searchParams.has('market') ? true : undefined });
    });
    const [found] = await client().search('token', `isrc:${recording.external_ids.isrc}`);
    assert.equal(trackEligibility(found).eligible, true);
    const fetched = await client().track('token', found.id);
    assert.doesNotThrow(() => assertSelectedRecording(fetched, {
      id: found.id, title: found.name, artist: found.artists[0].name, album: found.album.name,
      durationMs: found.duration_ms!, explicit: found.explicit!, isrc: found.external_ids?.isrc,
      url: `https://open.spotify.com/track/${found.id}`, evidence: ['playable'],
    }));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].searchParams.has('market'), false);
    assert.equal(calls[1].searchParams.get('market'), 'from_token');
    mocked.mock.restore();
  }
});

test('catalog permission errors stay distinct from playback and Premium errors', async t => {
  for (const [body, catalogCode, playbackCode] of [
    [{ error: { message: 'Insufficient client scope' } }, 'catalog_insufficient_scope', 'insufficient_scope'],
    [{ error: { message: 'App not allowed' } }, 'catalog_forbidden', 'forbidden'],
    [{ error: { reason: 'PREMIUM_REQUIRED' } }, 'premium_required', 'premium_required'],
  ] as const) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => json(body, 403));
    await assert.rejects(client().search('token', 'Tron'), { code: catalogCode, status: 403 });
    await assert.rejects(client().track('token', ID), { code: catalogCode, status: 403 });
    await assert.rejects(client().enqueue('token', ID), { code: playbackCode, status: 403, unknownDelivery: false });
    mocked.mock.restore();
  }
});

test('queue diagnostics distinguish phases without exposing response bodies or transport messages', async t => {
  const cases = [
    { response: () => new Response('not-json'), phase: 'response_decode', status: 200 },
    { response: () => new Response(null, { status: 202 }), phase: 'response_status', status: 202 },
    { response: () => new Response('large', { headers: { 'Content-Length': String(PROVIDER_BODY_LIMIT + 1) } }), phase: 'response_headers', status: 200 },
    { response: () => new Response(new ReadableStream({ start(c) { c.error(new Error('private response body')); } })), phase: 'response_body', status: 200 },
    { response: () => { throw new TypeError('private token URL', { cause: Object.assign(new Error('private hostname'), { code: 'ECONNRESET' }) }); }, phase: 'request', status: undefined, transportCode: 'ECONNRESET' },
    { response: () => { throw Object.assign(new Error('private message'), { code: 'PRIVATE_SECRET' }); }, phase: 'request', status: undefined },
  ];
  for (const fixture of cases) {
    let calls = 0;
    const mocked = t.mock.method(globalThis, 'fetch', async () => { calls++; return fixture.response(); });
    await assert.rejects(client().enqueue('token', ID), error => {
      assert.ok(error instanceof SpotifyError);
      assert.equal(error.unknownDelivery, true);
      assert.equal(error.status, fixture.status);
      assert.equal(error.diagnostics.phase, fixture.phase);
      assert.equal(error.diagnostics.transportCode, fixture.transportCode);
      assert.doesNotMatch(JSON.stringify(error), /private|PRIVATE_SECRET/);
      return true;
    });
    assert.equal(calls, 1);
    mocked.mock.restore();
  }
});

test('local enqueue validation is definitely unsent, including invalid token headers', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not send'); });
  for (const token of ['', 'bad\r\ntoken']) {
    await assert.rejects(client().enqueue(token, ID), error =>
      error instanceof SpotifyError && !error.unknownDelivery && error.diagnostics.phase === 'preflight');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('host-market responses still reject unknown, restricted, local and relinked tracks', async t => {
  for (const variant of [
    { is_playable: undefined }, { is_playable: false }, { restrictions: { reason: 'market' } },
    { is_local: true }, { linked_from: { id: OTHER } }, { id: OTHER, linked_from: { id: ID } },
  ]) {
    const mocked = t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
      assert.equal(new URL(String(input)).searchParams.get('market'), 'from_token');
      return json({ ...track(), ...variant });
    });
    const result = await client().track('token', ID);
    assert.throws(() => assertTrackEligible(result, ID), { code: 'track_unavailable' });
    mocked.mock.restore();
  }
});

test('malformed provider data is not converted to empty catalog results', async t => {
  const cases: [unknown, (instance: SpotifyClient) => Promise<unknown>][] = [
    [{}, instance => instance.profile('token')],
    [{ devices: [{}] }, instance => instance.devices('token')],
    [{ tracks: { items: Array(11).fill(track()) } }, instance => instance.search('token', 'song')],
    [{ ...track(), is_playable: 'yes' }, instance => instance.track('token', ID)],
    [{ ...track(), artists: [] }, instance => instance.track('token', ID)],
    [{ ...track(), restrictions: [] }, instance => instance.track('token', ID)],
    [{ ...track(), external_ids: { isrc: 123 } }, instance => instance.track('token', ID)],
    [{ access_token: 'x', expires_in: '3600', scope: 'x' }, instance => instance.refresh('refresh')],
  ];
  for (const [body, action] of cases) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => json(body));
    await assert.rejects(action(client()), (error: unknown) => error instanceof SpotifyError && error.code === 'invalid_response');
    mocked.mock.restore();
  }
});

test('eligibility demands positive playable evidence and exact ID without relinking', () => {
  assert.deepEqual(trackEligibility(track(), ID), { eligible: true });
  assert.doesNotThrow(() => assertTrackEligible(track(), ID));
  assert.throws(() => assertTrackEligible(track(), OTHER), (error: unknown) =>
    error instanceof SpotifyError && error.code === 'track_unavailable' && !error.unknownDelivery);
  for (const variant of [
    { id: OTHER }, { is_playable: undefined }, { is_playable: false },
    { linked_from: { id: OTHER } }, { linked_from: {} }, { restrictions: { reason: 'market' } }, { is_local: true },
  ]) assert.equal(trackEligibility({ ...track(), ...variant }, ID).eligible, false);
});

test('pre-send recording validation demands unchanged complete selected metadata, without fuzzy tolerance', () => {
  const selected: PartyCandidate = {
    id: ID, title: 'Song', artist: 'Artist', album: 'Album', durationMs: 200_000,
    explicit: false, url: `https://open.spotify.com/track/${ID}`, evidence: ['direct_spotify_id'],
  };
  assert.doesNotThrow(() => assertSelectedRecording(track(), selected));
  assert.doesNotThrow(() => assertSelectedRecording({ ...track(), name: 'ＳＯＮＧ', album: { name: 'album' } }, selected));
  const variants: Partial<SpotifyTrack>[] = [
    { name: 'Song (Live)' }, { name: 'Song - Remastered' }, { name: 'Song - Radio Edit' },
    { name: 'Song - Spanish Version' }, { name: 'Song - Clean' },
    { artists: [{ name: 'Other Artist' }] }, { album: { name: 'Album - Remastered' } },
    { album: { name: 'Another Album' } }, { explicit: true }, { explicit: undefined },
    { duration_ms: 200_001 }, { duration_ms: 199_999 }, { duration_ms: undefined },
    { duration_ms: 0 }, { external_ids: { isrc: 'USABC1234567' } },
  ];
  for (const variant of variants) {
    assert.throws(() => assertSelectedRecording({ ...track(), ...variant }, selected), (error: unknown) =>
      error instanceof SpotifyError && error.code === 'recording_changed' && !error.unknownDelivery,
    JSON.stringify(variant));
  }
  for (const snapshot of [
    { title: '' }, { artist: '' }, { album: '' }, { durationMs: 0 }, { explicit: null },
    { isrc: 'USABC1234567' },
  ]) assert.throws(() => assertSelectedRecording(track(), { ...selected, ...snapshot }), (error: unknown) =>
    error instanceof SpotifyError && error.code === 'recording_changed');
  const identified = { ...selected, isrc: 'USABC1234567' };
  assert.doesNotThrow(() => assertSelectedRecording({ ...track(), external_ids: { isrc: 'usabc1234567' } }, identified));
  assert.throws(() => assertSelectedRecording({ ...track(), external_ids: { isrc: 'GBXYZ7654321' } }, identified),
    (error: unknown) => error instanceof SpotifyError && error.code === 'recording_changed');
  assert.throws(() => assertSelectedRecording({ ...track(), id: OTHER }, selected),
    (error: unknown) => error instanceof SpotifyError && error.code === 'track_unavailable');
  assert.throws(() => assertSelectedRecording({ ...track(), is_playable: false }, selected),
    (error: unknown) => error instanceof SpotifyError && error.code === 'track_unavailable');
});

test.after(() => mock.restoreAll());
