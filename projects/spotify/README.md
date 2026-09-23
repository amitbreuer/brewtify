# Server-only Spotify mechanics

`@brewtify/spotify` is a CommonJS, Node-only package. Do not import it into the
Mini App; the package exposes only a Node export. Party playback consent and
tokens are separate from the existing Library service. Both share only
`buildSpotifyAuthorizationUrl({ clientId, redirectUri, scopes, state,
codeChallenge? })`; the legacy scope configuration, OAuth exchanges, caching,
HTTP requests, and retry policies remain unchanged. The low-level URL builder
does not add scopes, validate legacy state, or enable PKCE unless requested.
The Party client validates its PKCE inputs and supplies only playback scopes.

`SpotifyClient({ clientId, redirectUri })` provides `authorizationUrl`,
`exchange`, `refresh`, `profile`, `devices`, `track`, `search`, and `enqueue`.
Tokens contain `accessToken`, optional rotated `refreshToken`, `expiresIn`, and
`scopes`. Track data preserves `is_playable`, `restrictions`, `linked_from`, and
the actual returned ID. Revalidate with `trackEligibility(track, requestedId)`
immediately before sending, or use `assertTrackEligible(track, requestedId)`
which throws `SpotifyError('track_unavailable')`.
Use `assertSelectedRecording(track, candidate)` before enqueue to additionally
check the selected recording snapshot: full normalized title, artist, album,
exact duration, known explicitness, and unchanged ISRC presence/value. Metadata
changes or incomplete evidence throw `SpotifyError('recording_changed')` before
any write. Unlike cross-catalog matching, this check has no duration tolerance.

All requests use fixed official HTTPS origins, reject redirects, have an
8-second deadline (including body consumption), and a 1 MiB response limit.
Search requests use at most 10 results without imposing an Apple storefront
as the Spotify market. Both search and direct track reads explicitly request
`market=from_token`, Spotify's documented host-account market, without a country
lookup or additional OAuth scopes. Without an explicit market, direct metadata
can omit `is_playable` even for a track offered by search. See Spotify's
[track relinking contract](https://developer.spotify.com/documentation/web-api/concepts/track-relinking).
Unknown/false playability, restrictions, local tracks, relinking, and changed IDs
still fail closed; a market parameter is not itself proof of playability.
This changes only metadata reads: completed unavailable requests are not
automatically retried. After deployment, a guest must search and select again.
The shared server transport also serves free iTunes Store
lookup (`itunes`, `https://itunes.apple.com/`); it never fetches submitted links.
The shared transport uses an Undici dispatcher with a socket-connect DNS lookup.
It resolves only the three allowlisted provider hosts, validates the complete
answer set, and returns those exact vetted addresses to the connecting socket
(no separate check-then-resolve race). Mixed public/private answers fail closed.
Private, loopback, link-local, shared, documentation, multicast, reserved and
special-purpose IPv4 networks are denied. IPv6 must be global unicast and not
a special-purpose/documentation/transition range; IPv4-mapped and translated
IPv6 forms are denied altogether. TLS still validates the original provider
hostname. Every new connection repeats the check; pooled connections retain
their already-vetted destination.

**There are no transport retries**, including token refresh and safe reads.
The durable caller can retry reads. Queue writes accept only an explicit 204.
`SpotifyError` exposes `code`, `status`, `retryAfterSeconds`, and
`unknownDelivery`. Network/timeout/uncertain response/5xx queue failures require
unknown-delivery handling, never automatic resending. Explicit 429 rejections
carry the provider delay (60 seconds when absent/invalid) for durable scheduling.
Do not infer Premium requirements from generic 403 responses.

The API catalog adapter resolves Apple Music song links with an exact numeric ID
and the original storefront using public iTunes Store lookup. It requires no
Apple credentials, developer membership or signing key, and has no paid API fallback.
An empty result is unavailable, never a reason to try another country or recording.
iTunes Store coverage is not the complete Apple Music catalog and supplies no ISRC.
Only track explicitness is used: `explicit` is true; `cleaned` and `notExplicit`
are false; omission is unknown. Collection explicitness is never substituted.

Matching uses full normalized title and artist equality, version-bearing album
checks, known explicitness, and a maximum 2-second duration difference. ISRC
contradictions always reject. Unique complete ISRC matches are exact; without
ISRC on either side, complete title/artist/album evidence can be high confidence.
One-sided missing ISRC, unrated iTunes tracks, other missing critical evidence,
or multiple viable editions require host review. No fuzzy scoring resolves ties.
Provider/configuration outages are errors, not empty catalog results.
Most identified Spotify candidates therefore need a host version choice for iTunes
sources; combined artist formatting can also reduce coverage. This does not change
direct Spotify matching or allow title-only auto-selection.

The public service's archived guidance estimates 20 requests/minute, subject to
change. Party keeps its existing submission throttles and durable 429 scheduling,
not a global iTunes quota or lookup cache. Cross-instance aggregate quota compliance
is not guaranteed. See [the Party runbook](../../docs/party-queue.md) before widening
the pilot. Catalog failures/receipts use `itunes_*` codes rather than paid-API
credential errors.

Run `npm test --workspace=@brewtify/spotify` after installing root dependencies
and building `@brewtify/shared`. API catalog fixtures run with the API's
Node test runner. Tests use mocked providers and do not prove live pilot access,
market evidence, Telegram behavior, live iTunes coverage, or actual enqueue access.
