import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildRequest, run } from '../scripts/itunes-search.mjs';

const song = {
  kind: 'song',
  trackId: 617154366,
  trackName: 'Get Lucky',
  artistName: 'Daft Punk',
  collectionName: 'Random Access Memories',
  trackTimeMillis: 369000,
  trackExplicitness: 'notExplicit',
  artworkUrl100: 'https://example.com/art.jpg',
  trackViewUrl: 'https://music.apple.com/us/song/get-lucky/617154366',
};
const response = { resultCount: 1, results: [song], extra: { preserved: true } };

async function invoke(args, fetchImpl = async () => Response.json(response)) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    fetchImpl,
    stdout: { write: text => { stdout += text; } },
    stderr: { write: text => { stderr += text; } },
  });
  return { code, stdout, stderr };
}

test('search encodes text and sends fixed music/song parameters', () => {
  const { url, country } = buildRequest(['Beyonce & Jay-Z', '--country', 'GB', '--limit', '200']);
  assert.equal(url.origin, 'https://itunes.apple.com');
  assert.equal(url.pathname, '/search');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    term: 'Beyonce & Jay-Z', media: 'music', entity: 'song', country: 'gb', limit: '200',
  });
  assert.equal(country, 'gb');
  assert.equal(buildRequest(['hello']).url.searchParams.get('country'), 'us');
  assert.equal(buildRequest(['hello']).url.searchParams.get('limit'), '5');
  assert.equal(buildRequest(['hello', '--limit', '1']).url.searchParams.get('limit'), '1');
});

test('song links infer country; album links use track i, not album ID', () => {
  for (const input of [
    'https://music.apple.com/gb/song/get-lucky/617154366',
    'https://music.apple.com/gb/song/617154366',
    'https://music.apple.com/gb/album/random-access-memories/617154241?i=617154366&uo=4',
  ]) {
    const { url } = buildRequest([input]);
    assert.equal(url.origin, 'https://itunes.apple.com');
    assert.equal(url.pathname, '/lookup');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      id: '617154366', media: 'music', entity: 'song', country: 'gb',
    });
    assert.equal(buildRequest([input, '--country', 'US']).country, 'us');
  }
});

test('numeric track IDs use exact lookup with explicit country', () => {
  const request = buildRequest(['617154366', '--country', 'il', '--limit', '10']);
  assert.equal(request.id, '617154366');
  assert.equal(request.country, 'il');
  assert.equal(request.url.pathname, '/lookup');
  assert.equal(request.url.searchParams.has('limit'), false);
});

test('reject invalid inputs, URLs and options before any request', async () => {
  const invalid = [
    [], [' '], ['Daft', 'Punk'], ['0'], ['9007199254740992'],
    ['hello', '--bogus'], ['hello', '--country'], ['hello', '--country', 'USA'],
    ['hello', '--limit'], ['hello', '--limit', '0'], ['hello', '--limit', '201'],
    ['hello', '--limit', '1.5'], ['hello', '--limit', '1e2'],
    ['hello', '--json', '--json'], ['hello', '--country', 'us', '--country', 'gb'],
    ['https://example.com/us/song/name/123'],
    ['http://music.apple.com/us/song/name/123'],
    ['https://music.apple.com.evil.com/us/song/name/123'],
    ['https://user:password@music.apple.com/us/song/name/123'],
    ['https://music.apple.com:8080/us/song/name/123'],
    ['https://music.apple.com/us/song/name/123#fragment'],
    ['https://music.apple.com/us/album/name/123'],
    ['https://music.apple.com/us/album/name/123?i='],
    ['https://music.apple.com/us/album/name/123?i=456&i=789'],
    ['https://music.apple.com/us/song/name/123?i=456'],
    ['https://music.apple.com/us/song/name/abc'],
    ['https://music.apple.com/us/playlist/name/123'],
    ['https://music.apple.com/us/song/name/123/extra'],
    ['https:music.apple.com/us/song/name/123'],
    ['https://music.apple.com\\us\\song\\name\\123'],
    ['https://'], ['music.apple.com/us/song/name/123'], ['//music.apple.com/us/song/name/123'],
  ];
  for (const args of invalid) {
    const result = await invoke(args, () => { assert.fail('Must not fetch invalid input'); });
    assert.equal(result.code, 1, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Error: /);
  }
});

test('help is available without fetching', async () => {
  const result = await invoke(['--help'], () => { assert.fail('Help must not fetch'); });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /not the complete Apple Music catalog/);
  assert.equal(result.stderr, '');
});

test('CLI entry point prints help and sets process exit status on invalid input', () => {
  const script = new URL('../scripts/itunes-search.mjs', import.meta.url);
  for (const [args, status] of [[['--help'], 0], [['song', '--limit', '201'], 1]]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });
    assert.equal(result.status, status);
    if (status === 0) {
      assert.match(result.stdout, /Usage:/);
      assert.equal(result.stderr, '');
    } else {
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Limit must be an integer/);
    }
  }
});

test('JSON output preserves all response fields with no banner', async (t) => {
  const timeout = t.mock.method(AbortSignal, 'timeout');
  const result = await invoke(['Daft Punk', '--json'], async (url, options) => {
    assert.equal(url.pathname, '/search');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    assert.equal(options.redirect, 'error');
    return Response.json(response);
  });
  assert.equal(result.code, 0);
  assert.deepEqual(timeout.mock.calls[0].arguments, [15_000]);
  assert.deepEqual(JSON.parse(result.stdout), response);
  assert.equal(result.stderr, '');
});

test('human output shows comparison metadata and request context', async () => {
  const result = await invoke(['617154366']);
  assert.equal(result.code, 0);
  for (const text of [
    'Country: us', 'Request: https://itunes.apple.com/lookup?', 'Results: 1',
    'Track ID: 617154366', 'Get Lucky', 'Daft Punk', 'Random Access Memories',
    '6:09 (369000 ms)', 'notExplicit', song.artworkUrl100, song.trackViewUrl,
    'not the complete Apple Music catalog',
  ]) assert.ok(result.stdout.includes(text), text);
  assert.equal(result.stderr, '');
});

test('missing optional metadata is explicitly unavailable', async () => {
  const result = await invoke(['song'], async () => Response.json({
    resultCount: 1, results: [{ trackName: 'Song' }],
  }));
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Duration: unavailable/);
  assert.match(result.stdout, /Explicitness: unavailable/);
  assert.match(result.stdout, /Artwork: unavailable/);
});

test('no matches are successful, explicit in human output and unchanged in JSON', async () => {
  const empty = { resultCount: 0, results: [] };
  for (const input of ['missing song', '123']) {
    for (const json of [false, true]) {
      const result = await invoke([input, ...(json ? ['--json'] : [])], async () => Response.json(empty));
      assert.equal(result.code, 0);
      assert.equal(result.stderr, '');
      if (json) assert.deepEqual(JSON.parse(result.stdout), empty);
      else assert.match(result.stdout, /Results: 0\nNo matches in this storefront/);
    }
  }
});

test('HTTP, rate limit, network, timeout, JSON and response errors exit nonzero', async () => {
  const cases = [
    [async () => new Response('', { status: 503 }), /HTTP 503/],
    [async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }), /HTTP 429.*Retry-After: 60/],
    [async () => { throw new TypeError('fetch failed'); }, /Network error.*fetch failed/],
    [async () => { throw new DOMException('timeout', 'TimeoutError'); }, /timed out after 15 seconds/],
    [async () => new Response('{broken'), /invalid JSON/],
    [async () => Response.json({ error: 'bad' }), /invalid response/],
    [async () => Response.json({ resultCount: 1, results: [] }), /invalid response/],
    [async () => Response.json({ resultCount: 1, results: [null] }), /invalid response/],
  ];
  for (const [fetchImpl, message] of cases) {
    const result = await invoke(['song', '--json'], fetchImpl);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
  }
});

test('exact lookup cannot silently accept an album or a different track', async () => {
  for (const results of [
    [{ wrapperType: 'collection', collectionId: 123 }, song],
    [{ ...song, trackId: 456 }],
  ]) {
    const result = await invoke(['617154366', '--json'], async () => Response.json({
      resultCount: results.length, results,
    }));
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /requested song ID/);
  }
});
