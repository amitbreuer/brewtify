import { pathToFileURL } from 'node:url';

const help = `Usage: node scripts/itunes-search.mjs <text | track ID | Apple Music song URL> [options]

Options:
  --country <code>  Two-letter storefront code (default: URL country, otherwise us)
  --limit <1..200>  Search result limit (default: 5; not used for exact lookup)
  --json           Print the unmodified response object as JSON, without a banner
  --help           Show this help

Examples:
  node scripts/itunes-search.mjs 'Daft Punk Get Lucky' --country us --limit 5
  node scripts/itunes-search.mjs 617154366 --country us --json
  node scripts/itunes-search.mjs 'https://music.apple.com/us/album/random-access-memories/617154241?i=617154366'

Uses the public iTunes catalog, not the complete Apple Music catalog.
No API key or membership required. Metadata is not proof of an identical recording.
Requests time out after 15 seconds; there are no automatic retries.
`;

function trackId(value) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('Track/album ID must be a positive safe integer.');
  }
  return value;
}

export function buildRequest(args) {
  let input;
  let country;
  let limit = '5';
  let json = false;
  let showHelp = false;
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith('-')) {
      if (!['--country', '--limit', '--json', '--help'].includes(arg)) {
        throw new Error(`Unknown option: ${arg}`);
      }
      if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
      seen.add(arg);
      if (arg === '--json') json = true;
      else if (arg === '--help') showHelp = true;
      else {
        const value = args[++index];
        if (!value || value.startsWith('-')) throw new Error(`Missing value for ${arg}`);
        if (arg === '--country') {
          if (!/^[a-z]{2}$/i.test(value)) throw new Error('Country must be a two-letter code.');
          country = value.toLowerCase();
        } else {
          if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 200) {
            throw new Error('Limit must be an integer from 1 to 200.');
          }
          limit = String(Number(value));
        }
      }
    } else {
      if (input !== undefined) throw new Error('Supply one input; quote multi-word search text.');
      input = arg.trim();
    }
  }
  if (showHelp) return { help: true };
  if (!input) throw new Error('Input is required. Use --help for examples.');

  let id;
  let linkCountry;
  if (/^\d+$/.test(input)) {
    id = trackId(input);
  } else if (/^[a-z][a-z\d+.-]*:/i.test(input) || /^(?:\/\/|www\.|[^\s/]+\.[a-z]{2,}(?:[/?#]|$))/i.test(input)) {
    if (!/^https:\/\/[^\\\s]+$/i.test(input)) {
      throw new Error('Malformed or unsupported URL; use a full https://music.apple.com song URL.');
    }
    let link;
    try {
      link = new URL(input);
    } catch {
      throw new Error('Malformed URL; use a full https://music.apple.com song URL.');
    }
    if (link.protocol !== 'https:' || link.hostname !== 'music.apple.com' ||
        link.port || link.username || link.password || link.hash) {
      throw new Error('Only https://music.apple.com song URLs without credentials, ports or fragments are supported.');
    }
    const match = link.pathname.match(/^\/([a-z]{2})\/(song|album)\/(?:[^/]+\/)?([1-9]\d*)\/?$/i);
    if (!match) throw new Error('Unsupported Apple Music URL; use /country/song/name/ID or /country/album/name/ID?i=TRACK.');
    linkCountry = match[1].toLowerCase();
    const pathId = trackId(match[3]);
    const songIds = link.searchParams.getAll('i');
    if (songIds.length > 1) throw new Error('URL must not contain multiple song IDs (i).');
    if (match[2].toLowerCase() === 'album') {
      if (!songIds.length) throw new Error('Album URLs require an i=TRACK song ID; an album is not a song.');
      id = trackId(songIds[0]);
    } else {
      id = pathId;
      if (songIds.length && trackId(songIds[0]) !== id) {
        throw new Error('Song URL contains conflicting track IDs.');
      }
    }
  }
  country ??= linkCountry ?? 'us';
  const url = new URL(id ? 'https://itunes.apple.com/lookup' : 'https://itunes.apple.com/search');
  url.searchParams.set(id ? 'id' : 'term', id ?? input);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('country', country);
  if (!id) url.searchParams.set('limit', limit);
  return { url, country, id, json };
}

function formatResults(data, request) {
  const lines = [
    'iTunes catalog (not the complete Apple Music catalog; not recording-proof).',
    `Country: ${request.country}`,
    `Request: ${request.url}`,
    `Results: ${data.resultCount}`,
  ];
  if (!data.results.length) lines.push('No matches in this storefront.');
  for (const [index, song] of data.results.entries()) {
    const ms = song.trackTimeMillis;
    const seconds = Math.round(ms / 1000);
    const duration = Number.isFinite(ms) && ms >= 0
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} (${ms} ms)`
      : 'unavailable';
    lines.push(
      '',
      `${index + 1}. ${song.trackName ?? 'unavailable'}`,
      `   Track ID: ${song.trackId ?? 'unavailable'}`,
      `   Artist: ${song.artistName ?? 'unavailable'}`,
      `   Album: ${song.collectionName ?? 'unavailable'}`,
      `   Duration: ${duration}`,
      `   Explicitness: ${song.trackExplicitness ?? 'unavailable'}`,
      `   Artwork: ${song.artworkUrl100 ?? song.artworkUrl60 ?? 'unavailable'}`,
      `   Link: ${song.trackViewUrl ?? 'unavailable'}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function run(args, {
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const request = buildRequest(args);
    if (request.help) {
      stdout.write(help);
      return 0;
    }
    const signal = AbortSignal.timeout(15_000);
    let data;
    try {
      const response = await fetchImpl(request.url, { signal, redirect: 'error' });
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        throw new Error(response.status === 429
          ? `HTTP 429: iTunes rate limit exceeded.${retryAfter ? ` Retry-After: ${retryAfter}.` : ''} Try again later.`
          : `HTTP ${response.status}: ${response.statusText || 'iTunes request failed'}.`);
      }
      try {
        data = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error('iTunes returned invalid JSON.');
        throw error;
      }
    } catch (error) {
      if (signal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error('iTunes request timed out after 15 seconds.');
      }
      if (error instanceof TypeError) throw new Error(`Network error contacting iTunes: ${error.message}`);
      throw error;
    }
    if (!data || !Number.isInteger(data.resultCount) || data.resultCount < 0 ||
        !Array.isArray(data.results) || data.resultCount !== data.results.length ||
        data.results.some(result => !result || typeof result !== 'object' || Array.isArray(result))) {
      throw new Error('iTunes returned an invalid response: expected resultCount and a results array.');
    }
    if (request.id && data.results.some(result =>
      result.kind !== 'song' || String(result.trackId) !== request.id)) {
      throw new Error('Lookup did not resolve to the requested song ID; albums and other media are not supported.');
    }
    stdout.write(request.json ? `${JSON.stringify(data, null, 2)}\n` : formatResults(data, request));
    return 0;
  } catch (error) {
    stderr.write(`Error: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
