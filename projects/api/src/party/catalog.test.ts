import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';
import type { PartyTrack } from '@brewtify/shared';
import { SpotifyError, type SpotifyTrack } from '@brewtify/spotify';
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

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const withAppleConfiguration = (t: { after: (fn: () => void) => void }) => {
  const names = ['APPLE_MUSIC_TEAM_ID', 'APPLE_MUSIC_KEY_ID', 'APPLE_MUSIC_PRIVATE_KEY'];
  const original = names.map(name => process.env[name]);
  process.env.APPLE_MUSIC_TEAM_ID = 'ABCDEFGHIJ';
  process.env.APPLE_MUSIC_KEY_ID = '0123456789';
  process.env.APPLE_MUSIC_PRIVATE_KEY = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  t.after(() => names.forEach((name, index) => {
    if (original[index] === undefined) delete process.env[name];
    else process.env[name] = original[index];
  }));
};
const appleBody = (attributes: Record<string, unknown> = {}) => ({
  data: [{ id: '123', type: 'songs', attributes: {
    name: 'The Song', artistName: 'The Artist', albumName: 'The Album',
    durationInMillis: 200_000, contentRating: 'clean', isrc: 'USABC1234567',
    artwork: { url: 'https://is1-ssl.mzstatic.com/image/{w}x{h}bb.jpg' },
    ...attributes,
  } }],
});

test('Apple adapter signs official ES256 JWT, never sends user token, searches ISRC then constrained title', async t => {
  withAppleConfiguration(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    calls++;
    assert.equal(url.toString(), 'https://api.music.apple.com/v1/catalog/us/songs/123');
    assert.equal(init?.redirect, 'manual');
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['Music-User-Token'], undefined);
    const jwt = headers.Authorization.slice(7).split('.');
    const head = JSON.parse(Buffer.from(jwt[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(jwt[1], 'base64url').toString());
    assert.equal(head.alg, 'ES256');
    assert.equal(head.kid, '0123456789');
    assert.equal(claims.iss, 'ABCDEFGHIJ');
    assert.equal(claims.exp - claims.iat, 300);
    assert.equal(verify('sha256', Buffer.from(jwt.slice(0, 2).join('.')),
      { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2], 'base64url')), true);
    return new Response(JSON.stringify(appleBody()));
  });
  const queries: string[] = [];
  const result = await resolveSong('https://music.apple.com/us/album/album/456?i=123', 'host-token', spotify({
    search: async (token, query) => { assert.equal(token, 'host-token'); queries.push(query); return [track()]; },
  }));
  assert.equal(result.confidence, 'exact');
  assert.deepEqual(queries, ['isrc:USABC1234567', 'track:"the song" artist:"the artist"']);
  assert.equal(result.source.artwork, 'https://is1-ssl.mzstatic.com/image/300x300bb.jpg');
  assert.equal(calls, 1);
});

test('Apple missing/invalid credentials are configuration errors, never empty results', async t => {
  withAppleConfiguration(t);
  delete process.env.APPLE_MUSIC_TEAM_ID;
  await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify()),
    (error: unknown) => error instanceof CatalogError && error.code === 'apple_configuration');
  process.env.APPLE_MUSIC_TEAM_ID = 'ABCDEFGHIJ';
  process.env.APPLE_MUSIC_PRIVATE_KEY = 'invalid';
  await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify()),
    (error: unknown) => error instanceof CatalogError && error.code === 'apple_configuration');
});

test('Apple omitted rating/duration are unknown, not fabricated clean/playtime evidence', async t => {
  withAppleConfiguration(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(appleBody({
    contentRating: undefined, durationInMillis: undefined,
  }))));
  const result = await resolveSong('https://music.apple.com/us/song/123', 'host', spotify());
  assert.equal(result.source.explicit, null);
  assert.equal(result.source.durationMs, 0);
  assert.equal(result.confidence, 'ambiguous');
  assert.equal(result.selected, undefined);
});

test('Apple status/error mapping and malformed payloads remain distinct from no match', async t => {
  withAppleConfiguration(t);
  const cases = [
    { status: 401, code: 'apple_unauthorized' }, { status: 403, code: 'apple_unauthorized' },
    { status: 429, code: 'apple_rate_limited' }, { status: 503, code: 'apple_unavailable' },
    { status: 302, code: 'apple_invalid_response' }, { status: 400, code: 'apple_rejected' },
    { status: 200, code: 'apple_invalid_response' },
  ];
  for (const fixture of cases) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response('{}', {
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
    (error: unknown) => error instanceof CatalogError && error.code === 'apple_unavailable');
  network.mock.restore();
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }));
  assert.equal((await resolveSong('https://music.apple.com/us/song/123', 'host', spotify())).confidence, 'no_match');
});

test('Apple returned ID mismatch and Spotify search outage are never no-match', async t => {
  withAppleConfiguration(t);
  const body = appleBody();
  body.data[0].id = '456';
  const response = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
  await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify()),
    (error: unknown) => error instanceof CatalogError && error.code === 'apple_invalid_response');
  response.mock.restore();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(appleBody())));
  await assert.rejects(resolveSong('https://music.apple.com/us/song/123', 'host', spotify({
    search: async () => { throw new SpotifyError('provider_unavailable', 503); },
  })), (error: unknown) => error instanceof SpotifyError && error.code === 'provider_unavailable');
});
