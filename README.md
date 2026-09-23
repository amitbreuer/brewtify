# Brewtify
Playlists Brewery for Spotify

## Linux build verification

The **Linux Docker build** pull-request check builds both stages of the production
image without cloud credentials, publishing, or deployment. To run the same check
locally with Docker:

```bash
docker build --pull --platform linux/amd64 --progress=plain --tag brewtify:ci .
```

The builder explicitly includes development and optional dependencies and loads
the Rolldown, Tailwind Oxide, Lightning CSS, and Rollup native bindings before
compilation. If installation or binding loading fails, it prints the captured
verbose npm log before exiting. Check this log for skipped packages and download
or installation failures. A "Cannot find native binding" error alone does not
prove that the lockfile is missing platform
entries. Preserve the committed dependency versions when investigating; do not
delete and regenerate the lockfile or upgrade packages as a first response.

## Party Queue pilot

The existing Telegram Mini App includes a feature-gated cross-service Party Queue.
See [setup, privacy, deployment and release gates](docs/party-queue.md) before enabling
`PARTY_ENABLED`. Library credentials and playback-only Party authorization are separate.
There is no Brewtify host allowlist. Hosts need Spotify app access, playback
authorization and Premium; Spotify's Development Mode restrictions still apply.

## iTunes catalog evaluation CLI

Standalone Node.js 22 script, with no dependencies, API key or music membership.
It only reads public iTunes metadata; it does not call Spotify or modify the app.

```bash
node scripts/itunes-search.mjs 'Daft Punk Get Lucky' --country us --limit 5
node scripts/itunes-search.mjs 617154366 --country us
node scripts/itunes-search.mjs 'https://music.apple.com/us/song/get-lucky/617154366'
node scripts/itunes-search.mjs 'https://music.apple.com/us/album/random-access-memories/617154241?i=617154366' --json
node scripts/itunes-search.mjs --help
node --test tests/itunes-search.test.mjs
```

Pass one quoted search, numeric track ID, or HTTPS Apple Music song link per run.
Country defaults to the link's storefront, otherwise `us`; `--country` overrides it.
Search limits are 1-200 (default 5); exact lookups ignore the limit. Bare album links
are rejected: select a song link with `?i=TRACK` instead.
Human output includes the request URL, country, count, track ID, title, artist,
album, duration, explicitness, artwork and song link. `--json` prints the complete
response object without a banner. No matches return exit code 0 (an empty results
array in JSON); invalid inputs or request errors print to stderr and exit 1.
Requests time out after 15 seconds and are not retried automatically.

This is the **iTunes catalog, not the complete Apple Music catalog**. Availability
and IDs can vary by storefront. Metadata is not proof of an identical recording;
these results do not provide ISRCs. Apple's
[archived Search API documentation](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)
describes an approximate rate limit of **20 calls/minute, subject to change**.
Keep evaluation requests small and space them out if rate-limited.
