import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PartyTrack } from '@brewtify/shared';
import { PROVIDER_BODY_LIMIT, SpotifyError, type SpotifyTrack } from '@brewtify/spotify';
import {
  CatalogError, matchCandidates, parseSongLink, resolveSong, type CatalogSpotifyClient,
} from './catalog';

const ID = '0123456789ABCDEFGHIJKL';
const OTHER = 'ABCDEFGHIJKLMNOPQRSTUV';
const source = (overrides: Partial<PartyTrack> = {}): PartyTrack => ({
  id: '123', title: 'The Song', artist: 'The Artist', album: 'The Album',
  durationMs: 200_000, explicit: false, isrc: 'USABC1234567',
  url: 'https://music.apple.com/us/song/123', ...overrides,
});
const track = (overrides: Partial<SpotifyTrack> = {}): SpotifyTrack => ({
  id: ID, name: 'The Song', artists: [{ name: 'The Artist' }], album: { name: 'The Album' },
  duration_ms: 200_000, explicit: false, is_playable: true,
  external_ids: { isrc: 'USABC1234567' }, ...overrides,
});
const spotify = (overrides: Partial<CatalogSpotifyClient> = {}): CatalogSpotifyClient => ({
  track: async () => track(),
  search: async () => [track()],
  ...overrides,
});

test('strict parser accepts canonical/localized Spotify and individual Apple forms', () => {
  for (const input of [
    `spotify:track:${ID}`, `https://open.spotify.com/track/${ID}`,
    ` https://open.spotify.com/track/${ID}?si=share `,
    `https://open.spotify.com/intl-de/track/${ID}`,
    `https://open.spotify.com/intl-pt-BR/track/${ID}/`,
  ]) assert.deepEqual(parseSongLink(input), { provider: 'spotify', id: ID, url: `https://open.spotify.com/track/${ID}` });
  for (const input of [
    'https://music.apple.com/us/song/123',
    'https://music.apple.com/us/song/the-song/123?l=en',
    'https://music.apple.com/us/album/the-album/456?i=123&l=en',
    'https://music.apple.com/us/album/456?i=123',
  ]) assert.deepEqual(parseSongLink(input), {
    provider: 'apple_music', id: '123', storefront: 'us', url: 'https://music.apple.com/us/song/123',
  });
});

test('parser rejects hostile, normalized, unsupported, ambiguous or malformed inputs', () => {
  const inputs = [
    '', 'https://music.apple.com/us/album/456', 'https://music.apple.com/us/album/a/456?i=123&i=123',
    'https://music.apple.com/us/album/a/456?i=123&%69=124',
    'https://music.apple.com/us/album/a/456?i=', 'https://music.apple.com/us/album/a/456?i=-123',
    'https://music.apple.com/us/album/a/456?i=1.2', 'https://music.apple.com/us/album/a/456?i=0123',
    'https://music.apple.com/us/song/a/123?i=124', 'https://music.apple.com/us/song/a%2fb/123',
    'https://music.apple.com/us/song/a%5cb/123', 'https://music.apple.com/us/song/%00/123',
    'https://music.apple.com/us/song/%GG/123', 'https://music.apple.com/USA/song/123',
    'https://music.apple.com/us/song/0', 'https://music.apple.com/us/song/123/extra',
    'https://music.apple.com/us/song/9007199254740992',
    'https://music.apple.com/us/album/a/456?i=99999999999999999999',
    'https://music.apple.com/us/playlist/foo/123', 'https://music.apple.com/us/song/123#fragment',
    `http://open.spotify.com/track/${ID}`, `https://open.spotify.com.evil.example/track/${ID}`,
    `https://evil.example@open.spotify.com/track/${ID}`, `https://open.spotify.com@evil.example/track/${ID}`,
    `https://open.spotify.com:8443/track/${ID}`, `https://open.spotify.com:443/track/${ID}`,
    `https://open.spotify.com./track/${ID}`, `https://open.spotify.com/artist/${ID}`,
    `https://open.spotify.com/album/${ID}`, `https://open.spotify.com/embed/track/${ID}`,
    `https://open.spotify.com/intl-foo/track/${ID}`, `https://open.spotify.com/de/track/${ID}`,
    `https://open.spotify.com/track/${ID}/extra`, 'https://open.spotify.com/track/123',
    `https://open.spotify.com/track/%30${ID.slice(1)}`, `https://open.spotify.com/./track/${ID}`,
    `https://open.spotify.com/a/../track/${ID}`, `https://open.spotify.com/%2e/track/${ID}`,
    `https://open.spotify.com\\track\\${ID}`, `https://open.spotify.com/\ttrack/${ID}`,
    `https://open.spotify.com/track/${ID}\n?si=x`, `https://open.spotify.com/track/${ID}#x`,
    `https://spotify.link/${ID}`, `https://127.0.0.1/track/${ID}`, `https://[::1]/track/${ID}`,
    `spotify:album:${ID}`, `spotify:track:${ID}:extra`, 'x'.repeat(2049),
  ];
  for (const input of inputs) assert.throws(() => parseSongLink(input), (error: unknown) =>
    error instanceof CatalogError && error.code === 'invalid_song_link', input);
});

test('unique recording with complete evidence matches exact, without ISRC needs full album evidence', () => {
  const exact = matchCandidates(source(), [track()]);
  assert.equal(exact.confidence, 'exact');
  assert.equal(exact.selected?.id, ID);
  assert.ok(exact.selected?.evidence.includes('same_isrc'));
  assert.equal(matchCandidates(source({ isrc: undefined }), [track({ external_ids: undefined })]).confidence, 'high');
  assert.equal(matchCandidates(source({ isrc: undefined }), [
    track({ external_ids: undefined, album: { name: 'Greatest Hits' } }),
  ]).confidence, 'ambiguous');
});

test('same ISRC never overrides version, language, explicitness, duration or artist contradictions', () => {
  const variants: Partial<SpotifyTrack>[] = [
    { name: 'The Song (Live)' }, { name: 'The Song - 2024 Remaster' }, { name: 'The Song (DJ Remix)' },
    { name: 'The Song - Radio Edit' }, { name: 'The Song - Spanish Version' }, { name: 'The Song (Clean)' },
    { name: 'The Song - Instrumental' }, { name: 'The Song - Acoustic' }, { name: 'The Song - Sped Up' },
    { name: 'The Song - Extended Mix' }, { album: { name: 'The Album - Live' } },
    { album: { name: 'The Album (Remastered)' } }, { explicit: true }, { duration_ms: 202_001 },
    { duration_ms: 197_999 }, { artists: [{ name: 'Cover Artist' }] }, { external_ids: { isrc: 'GBXYZ7654321' } },
  ];
  for (const variant of variants) {
    const result = matchCandidates(source(), [track(variant)]);
    assert.equal(result.confidence, 'no_match', JSON.stringify(variant));
    assert.equal(result.selected, undefined);
  }
  assert.equal(matchCandidates(source({ title: 'The Song (Live)' }), [track()]).confidence, 'no_match');
  assert.equal(matchCandidates(source({ title: 'The Song - Alice Remix' }), [
    track({ name: 'The Song - Bob Remix' }),
  ]).confidence, 'no_match');
  assert.equal(matchCandidates(source({ album: 'The Album - 2020 Remaster' }), [
    track({ album: { name: 'The Album - 2024 Remaster' } }),
  ]).confidence, 'no_match');
});

test('duration tolerance boundaries are deterministic and missing critical evidence never auto-selects', () => {
  for (const duration of [198_000, 202_000]) assert.equal(
    matchCandidates(source(), [track({ duration_ms: duration })]).confidence, 'exact',
  );
  for (const candidate of [
    track({ duration_ms: undefined }), track({ explicit: undefined }),
    track({ album: { name: '' } }), track({ external_ids: undefined }),
  ]) {
    const result = matchCandidates(source(), [candidate]);
    assert.equal(result.confidence, 'ambiguous');
    assert.equal(result.selected, undefined);
  }
  for (const input of [source({ explicit: null }), source({ durationMs: 0 }), source({ album: '' }), source({ isrc: undefined })]) {
    assert.equal(matchCandidates(input, [track()]).confidence, 'ambiguous');
  }
});

test('duplicate track IDs deduplicate; distinct editions and incomplete alternatives remain ambiguous', () => {
  assert.equal(matchCandidates(source(), [track(), track()]).confidence, 'exact');
  assert.equal(matchCandidates(source(), [track(), track({ explicit: true })]).confidence, 'ambiguous');
  assert.equal(matchCandidates(source(), [track(), track({ is_playable: false })]).confidence, 'ambiguous');
  const result = matchCandidates(source(), [track(), track({ id: OTHER })]);
  assert.equal(result.confidence, 'ambiguous');
  assert.equal(result.selected, undefined);
  assert.equal(result.candidates.length, 2);
  assert.equal(matchCandidates(source(), [track(), track({ id: OTHER, explicit: undefined })]).confidence, 'ambiguous');
  const many = Array.from({ length: 20 }, (_, index) => track({ id: String(index).padStart(22, '0') }));
  assert.equal(matchCandidates(source(), many).candidates.length, 10);
  assert.equal(matchCandidates(source(), Array(21).fill(track())).confidence, 'ambiguous');
});

test('direct Spotify requires same requested ID, positive playability and no relinking/restrictions', async () => {
  assert.equal((await resolveSong(`spotify:track:${ID}`, 'host', spotify())).confidence, 'exact');
  for (const variant of [
    { id: OTHER }, { is_playable: undefined }, { is_playable: false },
    { linked_from: { id: OTHER } }, { restrictions: { reason: 'market' } }, { is_local: true },
  ]) {
    const result = await resolveSong(`spotify:track:${ID}`, 'host', spotify({ track: async () => track(variant) }));
    assert.equal(result.confidence, 'no_match');
    assert.equal(result.selected, undefined);
    assert.equal(result.source.id, ID);
  }
});

test('Spotify outages and auth failures propagate, only explicit missing track becomes no-match', async () => {
  for (const code of ['network', 'rate_limited', 'unauthorized', 'provider_unavailable', 'invalid_response'] as const) {
    const error = new SpotifyError(code);
    await assert.rejects(resolveSong(`spotify:track:${ID}`, 'host', spotify({ track: async () => { throw error; } })), error);
  }
  assert.equal((await resolveSong(`spotify:track:${ID}`, 'host', spotify({
    track: async () => { throw new SpotifyError('not_found', 404); },
  }))).confidence, 'no_match');
});

const itunesBody = (attributes: Record<string, unknown> = {}) => ({
  resultCount: 1,
  results: [{
    wrapperType: 'track', kind: 'song', trackId: 123,
    trackName: 'The Song', artistName: 'The Artist', collectionName: 'The Album',
    trackTimeMillis: 200_000, trackExplicitness: 'notExplicit',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg',
    ...attributes,
  }],
});

test('iTunes uses exact ID and original storefront without credentials; missing ISRC requires host choice', async t => {
  for (const name of ['APPLE_MUSIC_TEAM_ID', 'APPLE_MUSIC_KEY_ID', 'APPLE_MUSIC_PRIVATE_KEY']) {
    const original = process.env[name];
    delete process.env[name];
    t.after(() => {
      if (original !== undefined) process.env[name] = original;
    });
  }
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    calls++;
    assert.equal(url.toString(), 'https://itunes.apple.com/lookup?id=123&country=il');
    assert.equal(init?.redirect, 'manual');
    assert.deepEqual(init?.headers, { Accept: 'application/json' });
    return new Response(JSON.stringify(itunesBody()));
  });
  const queries: string[] = [];
  for (const input of [
    'https://music.apple.com/il/album/wrong-url-title/456?i=123&country=us',
    'https://music.apple.com/il/song/wrong-url-title/123',
  ]) {
    const result = await resolveSong(input, 'host-token', spotify({
      search: async (token, query) => { assert.equal(token, 'host-token'); queries.push(query); return [track()]; },
    }));
    assert.equal(result.confidence, 'ambiguous');
    assert.equal(result.selected, undefined);
    assert.equal(result.source.isrc, undefined);
    assert.equal(result.source.url, 'https://music.apple.com/il/song/123');
    assert.equal(result.source.artwork, 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg');
    assert.deepEqual(result.candidates[0].evidence, [
      'same_title_and_artist', 'playable', 'duration_within_2000ms', 'same_explicitness', 'same_album', 'incomplete_evidence',
    ]);
  }
  assert.deepEqual(queries, Array(2).fill('track:"the song" artist:"the artist"'));
  assert.equal(calls, 2);
});

test('iTunes missing metadata remains unknown; collection rating and unsolicited ISRC are not track evidence', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(itunesBody({
    trackExplicitness: undefined, trackTimeMillis: undefined, collectionName: undefined,
    collectionExplicitness: 'explicit', isrc: 'USABC1234567',
  }))));
  const result = await resolveSong('https://music.apple.com/us/song/123', 'host', spotify());
  assert.equal(result.source.explicit, null);
  assert.equal(result.source.durationMs, 0);
  assert.equal(result.source.album, '');
  assert.equal(result.source.isrc, undefined);
  assert.equal(result.confidence, 'ambiguous');
  assert.equal(result.selected, undefined);
});

test('iTunes preserves combined artists, version title, duration and track-specific explicitness', async t => {
  for (const [rating, explicit] of [['explicit', true], ['cleaned', false], ['notExplicit', false]] as const) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(itunesBody({
      trackName: 'Song (Live)', artistName: 'Artist A, Artist B & Artist C', collectionName: 'Album (Remastered)',
      trackTimeMillis: 226547, trackExplicitness: rating, collectionExplicitness: 'explicit',
    }))));
    const result = await resolveSong('https://music.apple.com/us/song/123', 'host', spotify());
    assert.equal(result.source.title, 'Song (Live)');
    assert.equal(result.source.artist, 'Artist A, Artist B & Artist C');
    assert.equal(result.source.album, 'Album (Remastered)');
    assert.equal(result.source.durationMs, 226547);
    assert.equal(result.source.explicit, explicit);
    assert.equal(result.confidence, 'no_match', 'different version cannot become a title-only match');
    mocked.mock.restore();
  }
});

test('iTunes status/error mapping and malformed payloads remain distinct from no match', async t => {
  const cases = [
    { status: 401, code: 'itunes_rejected' }, { status: 403, code: 'itunes_rejected' },
    { status: 429, code: 'itunes_rate_limited' }, { status: 503, code: 'itunes_unavailable' },
    { status: 302, code: 'itunes_invalid_response' }, { status: 400, code: 'itunes_rejected' },
    { status: 200, code: 'itunes_invalid_response' }, { status: 204, code: 'itunes_rejected' },
  ];
  for (const fixture of cases) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(fixture.status === 204 ? null : '{}', {
      status: fixture.status, headers: { 'Retry-After': '17', Location: 'http://127.0.0.1/' },
    }));
    await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify()), (error: unknown) => {
      assert.ok(error instanceof CatalogError);
      assert.equal(error.code, fixture.code);
      if (fixture.status === 429) assert.equal(error.retryAfterSeconds, 17);
      return true;
    });
    mocked.mock.restore();
  }
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify()),
    (error: unknown) => error instanceof CatalogError && error.code === 'itunes_unavailable');
  network.mock.restore();
});

test('iTunes no-result never falls back to another country, album or guessed URL title', async t => {
  for (const status of [200, 404]) {
    let calls = 0;
    const mocked = t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
      calls++;
      assert.equal(String(input), 'https://itunes.apple.com/lookup?id=123&country=il');
      return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status });
    });
    const result = await resolveSong('https://music.apple.com/il/album/title/456?i=123', 'host', spotify({
      search: async () => assert.fail('No metadata, no Spotify search'),
    }));
    assert.equal(result.confidence, 'no_match');
    assert.equal(result.selected, undefined);
    assert.equal(calls, 1);
    mocked.mock.restore();
  }
});

test('iTunes malformed, mismatched and non-song results are rejected rather than cached or matched', async t => {
  const bodies = [
    {}, null, [], { results: [] }, { resultCount: '0', results: [] },
    { resultCount: 1, results: [] }, { resultCount: 0, results: itunesBody().results },
    { resultCount: 2, results: [...itunesBody().results, ...itunesBody().results] },
    { resultCount: 1, results: [null] },
    ...[
      { trackId: 456 }, { trackId: '123' }, { trackId: 123.5 }, { trackId: 9007199254740992 },
      { kind: 'music-video' }, { wrapperType: 'collection' }, { trackName: '' },
      { trackName: ' ' }, { artistName: null }, { collectionName: null },
      { trackTimeMillis: -1 }, { trackTimeMillis: 0 }, { trackTimeMillis: 1.5 }, { trackTimeMillis: '200000' },
      { trackExplicitness: 'clean' }, { trackExplicitness: null }, { trackExplicitness: ['explicit'] },
    ].map(attributes => itunesBody(attributes)),
  ];
  for (const body of bodies) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
    await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify({
      search: async () => assert.fail('Malformed data must not reach matching'),
    })), (error: unknown) => error instanceof CatalogError && error.code === 'itunes_invalid_response');
    mocked.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(itunesBody())));
  assert.equal((await resolveSong('https://music.apple.com/us/song/123', 'host', spotify())).source.title, 'The Song');
});

test('iTunes discards unsafe artwork without trusting trackViewUrl or losing song metadata', async t => {
  for (const artworkUrl100 of [
    'http://is1-ssl.mzstatic.com/a.jpg', 'https://mzstatic.com.evil.test/a.jpg',
    'https://user:pass@is1-ssl.mzstatic.com/a.jpg', 'https://127.0.0.1/a.jpg',
    'https://is1-ssl.mzstatic.com:8443/a.jpg', 'javascript:alert(1)', 123,
  ]) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(itunesBody({
      artworkUrl100, trackViewUrl: 'http://127.0.0.1/',
    }))));
    const result = await resolveSong('https://music.apple.com/us/song/123', 'host', spotify());
    assert.equal(result.source.artwork, undefined);
    assert.equal(result.source.url, 'https://music.apple.com/us/song/123');
    mocked.mock.restore();
  }
});

test('iTunes response size limits apply and non-JSON 429 retains durable retry delay', async t => {
  for (const declared of [true, false]) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(PROVIDER_BODY_LIMIT + 1), {
      headers: declared ? { 'content-length': String(PROVIDER_BODY_LIMIT + 1) } : {},
    }));
    await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify()),
      (error: unknown) => error instanceof CatalogError && error.code === 'itunes_invalid_response');
    mocked.mock.restore();
  }
  for (const retry of ['17', 'invalid']) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response('Too many requests', {
      status: 429, headers: { 'Retry-After': retry },
    }));
    await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify()), (error: unknown) =>
      error instanceof CatalogError && error.code === 'itunes_rate_limited'
        && error.retryAfterSeconds === (retry === '17' ? 17 : 60));
    mocked.mock.restore();
  }
});

test('Spotify search outage after iTunes lookup is never no-match', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(itunesBody())));
  await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify({
    search: async () => { throw new SpotifyError('provider_unavailable', 503); },
  })), (error: unknown) => error instanceof SpotifyError && error.code === 'provider_unavailable');
});
