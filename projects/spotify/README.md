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
as the Spotify market. The shared server transport also serves the official
Apple catalog API; it never fetches submitted links.
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

The API catalog adapter requires `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, and
`APPLE_MUSIC_PRIVATE_KEY` (P-256 PEM, with literal or escaped newlines). It signs
short-lived ES256 developer JWTs; no Apple user token is requested.

Matching uses full normalized title and artist equality, version-bearing album
checks, known explicitness, and a maximum 2-second duration difference. ISRC
contradictions always reject. Unique complete ISRC matches are exact; without
ISRC on either side, complete title/artist/album evidence can be high confidence.
One-sided missing ISRC, unrated Apple tracks, other missing critical evidence,
or multiple viable editions require host review. No fuzzy scoring resolves ties.
Provider/configuration outages are errors, not empty catalog results.

Run `npm test --workspace=@brewtify/spotify` after installing root dependencies
and building `@brewtify/shared`. API catalog fixtures run with the API's
Node test runner. Tests use mocked providers and do not prove live pilot access,
market evidence, Telegram behavior, Apple credentials, or actual enqueue access.
