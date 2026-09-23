# Cross-service Party Queue pilot

Party extends `/app` and the existing bot. Library retains its own login and
Playlists/Artists views. Party requests append to the host's Spotify playback
queue, never to a playlist or Spotify Jam. A successful command means **accepted,
not played**. Spotify and other controllers can affect eventual playback order.

Hosts and guests paste a complete song link to search after 500 ms without
submitting anything. Results use the same compact artwork/title/artist/album
cards as the room list. Clicking a result is the **only confirmation**: it creates
a durable queue job, without a dialog or routine host approval (including in
legacy approval-mode rooms). Multiple version-safe matches remain explicit choices.
The API stores a generic `Guest` label, not a Telegram name. The room has no
settings or approval panel. Hosts share the invitation and can end the party
(which deletes its credentials). Older submission/host-choice APIs retain their
existing behavior for legacy requests and recovery.

Search alone never creates a request or outbox job. The Mini App shows
**Added to the queue** only after its own selected request is `added` following a
confirmed Spotify 204; 202/outbox creation shows progress, not success. A completed
current search with no eligible results shows **Not found** once. Provider
outages, authentication failures and throttling stay explicit errors.

Start party authorizes Spotify when needed, then opens the room automatically.
There is no device-selection screen or separate create step. Queue commands use
the host's token and omit `device_id`, so Spotify targets that account's active
playback. Switching devices in Spotify intentionally moves subsequent additions
with it; Brewtify never transfers playback. This replaces the original
device-pinning behavior for all rooms, including existing ones.

## Release gate

`PARTY_ENABLED` defaults to false. Existing Library navigation and bot behavior
remain available without new secrets, schema access, or provider initialization.
The deploy workflow reads the repository variable `PARTY_ENABLED`, defaulting to
false. Keep it false until every gate below is verified on a separate test service.
No cloud resources, bot settings or Spotify playback are changed by adding these
files. Terraform is a reviewed provisioning artifact, **not an applied deployment**.

Required before real pilot traffic:

- Spotify app access for the intended hosts (check the actual app's current
  Development Mode access restrictions and authorization allocation), a deliberately
  selected Premium host, and the exact dedicated callback URI registered on the app.
- Minimal-scope `/me` identity, host-token catalog/playability/relinking,
  search (limit ten), and active-playback queue access verified with that app.
  Party now requests only `user-modify-playback-state`; device discovery and its
  read-playback scope are no longer used. Existing grants with the extra read
  scope remain compatible until revoked or reauthorized.
  The Premium checkbox is an explicit requirement, not proof from a removed
  profile property. Only an explicit provider Premium error is labeled Premium.
- Free iTunes Store exact-ID lookup reachable from the service for supported
  Apple Music song links. No Apple Developer membership, keys, tokens, Apple ID
  or guest provider authorization is required. Coverage is not all Apple Music;
  verify the intended storefront and review the matching limitations below.
- PostgreSQL migrations, direct/session-pinned connections supporting **session
  advisory locks** (do not use PgBouncer/Neon transaction pooling for Party).
- Cloud Tasks queue, runtime enqueue/actAs grants, OIDC identity and audience,
  Scheduler maintenance every minute, Secret Manager access, and log exclusions.
- The actual Telegram bot username and Main Mini App configured in BotFather
  on a **test bot**. Never replace the live bot's URL for development.
- Real HTTPS Android/iOS/Desktop Telegram checks of signed `initData`, Secure
  HttpOnly cookies, invitations, BackButton and external-browser OAuth return.
  A local browser preview is not proof of any of these integrations.
- An explicitly authorized deliberate song for the final queue test. Starting a party never
  enqueues a surprise eligibility probe.

Missing configuration returns an actionable error; it is never a catalog no-match
or an authentication bypass. Brewtify has no host allowlist: when Party is enabled,
any account that can authorize the Spotify app can host after confirming Premium.
Spotify's provider-owned access restrictions still apply; removing Brewtify's list
does not expand the app's Spotify access or enable Party in production.

## Database migration

This repository previously used Prisma without a migration history. The new
`20260922000000_library_baseline` captures the unchanged Library schema.

For a **new isolated database**:

```sh
npm ci
npm run build
cd projects/api
DATABASE_URL='<isolated PostgreSQL URL>' npx prisma migrate deploy
```

For an **existing** database, first compare its schema to the Library baseline,
take a backup and confirm that it matches. Only then, with explicit operator
approval, mark that baseline applied and deploy the additive Party migration:

```sh
npx prisma migrate resolve --applied 20260922000000_library_baseline
npx prisma migrate deploy
```

The later `20260923093000_party_active_playback` migration drops the retired
Party device column and normalizes legacy device-blocked states. Keep Party
disabled and drain/pause old Party workers while applying this migration and
deploying the matching API revision; old device-pinning code is incompatible
with the removed column. Library data is unchanged.

Never run `db push`, reset, or automatically mark an unknown schema as baselined.
Keep the custom partial unique indexes, status checks, approval sequence and
request-revision trigger in subsequent migrations. The trigger gives bounded
cursor polling a monotonic cursor even when multiple changes share a millisecond.

## Provisioning and deployment

`deploy/party/main.tf` provisions a queue, least-privilege service identity,
invocation/token grants, URL-log exclusions and a **paused** Scheduler job.
Choose supported Cloud Tasks/Scheduler regions; they need not both be the Cloud
Run region. Review `terraform plan`, then obtain approval before `terraform apply`.
The provisioning caller needs permission to act as the new Scheduler identity.
Service-agent IAM grants can require the APIs' managed service identities to be
created first in a newly provisioned project.

Take environment values from the Terraform `party_environment` output and
`projects/api/.env.party.example`. Configure these on the isolated Cloud Run
revision, with `PARTY_ENABLED=false`. Bind `PARTY_IDENTITY_KEY` (independent random
32-byte hex) through Secret Manager. No host-list configuration is required. Existing encryption
and Spotify client configuration are reused; Library token rows are not.
Apple team/key IDs, signing PEMs and developer tokens are no longer used and
can be removed from Party configuration when retiring the old revision.
Never use a `VITE_` variable for secrets.

Use explicit Cloud Run `--update-env-vars` / `--update-secrets` for these settings,
not replacement of existing Library configuration. The existing deploy action's
merge behavior retains provisioned Party settings. After migrations, verify a
correct-audience OIDC request to `/internal/party/maintenance` succeeds and an
unsigned or wrong-service-account request fails even on the public Cloud Run
service. Resume the Scheduler job only after that check; leave cleanup enabled
even when Party intake is disabled. Set the repository `PARTY_ENABLED` variable
to `true` only after the release gates pass, then deploy the approved revision.
Auto-add is now the default; `PARTY_AUTO_ENABLED` is retired. Verify abuse
controls as part of the `PARTY_ENABLED` release gate rather than a second opt-in.

Cloud Tasks delivers `POST /internal/party/jobs`. Scheduler calls
`POST /internal/party/maintenance`. Both verify Google ID tokens, exact audience,
verified email and the configured service account; task-looking headers confer
no authority. Do not create public cron-secret alternatives for these routes.
Queue dispatch and handler retries do not themselves establish Spotify idempotency.

## Authorization and privacy

Party never trusts `initDataUnsafe`, a raw Telegram-ID header or a development ID.
A signed launch is accepted for five minutes (30-second future skew) and is
single-use except reuse from its already authenticated cookie. Sessions last
one hour; reopen from Telegram to renew. Sessions store keyed principal hashes,
not Telegram names/IDs. Guests have room-scoped keyed pseudonyms and see only
their own receipts. Party does not create Library `User` rows.

Start party creates a ten-minute authorization transaction bound to the verified
Mini App session/principal. A one-use launch ticket establishes a separate external
browser cookie, random OAuth state and S256 verifier. Callback consumption is
atomic. The Mini App polls its transaction with its own cookie; it does not rely
on the browser sharing cookies. Return-to-Telegram links grant no host privileges.
Cancellation/replay/expiry require a new explicit Start. Connected credentials
not yet attached to a room expire after 30 minutes. Active rooms have a fixed
12-hour TTL. Creating a room again for its verified owner returns the existing
room and invitation without extending the TTL or duplicating the room.
Spotify profile identity and account locks still enforce one active room per account;
opening host access does not relax credential isolation, throttles or the 12-hour TTL.

Party token refresh uses database serialization and preserves rotated refresh
tokens. Explicit revocation deletes Party credentials, not Library tokens.
Closing/disconnecting deletes Party credentials immediately and cancels unsent
work. A command already in flight or in Spotify's queue cannot be recalled.
Switching tabs and Library logout do not disconnect Party.

All mutation APIs require the configured exact HTTPS Origin and a session CSRF
token. Cookies are `Secure`, `HttpOnly`, `SameSite=Lax` and host-only. Failure in
Telegram's cookie storage is a release blocker, never a reason to expose provider
tokens. The app uses text rendering and bounded request bodies/input lengths.
Database-backed throttles are shared across instances and fail closed. Bootstrap
and authenticated-request IP throttling use the socket peer address, **not**
caller-controlled forwarded headers; behind
Cloud Run that may be a shared proxy, so its broad ceiling is intentionally high.
Verified-principal/session/room throttles supply the more selective controls.
Do not blindly enable Express `trust proxy=true`. Review trusted edge topology
and ingress-level abuse controls before increasing traffic.

The maintenance job deletes expired rooms and all linked requests/candidates/jobs/
attempts/memberships in batches of 100, and expired sessions/auth flows/throttles/
credentials in batches of 500. Every operational path enforces expiry immediately;
physical deletion normally follows on the next minute tick, longer under backlog
or outage. Monitor oldest expired row/outbox age and alert when above five minutes.
Set a short operational log retention (recommended seven days), check every
proxy/log sink for full URLs, and document the actual Neon/managed backup/PITR
retention in the deployment runbook. Physical deletion does **not** synchronously
erase managed backups. Restore procedures must immediately run expiry cleanup.

## Delivery and failure handling

### Apple Music links via free iTunes Store lookup

Apple Music remains an accepted **link format**, not the catalog API used.
`music.apple.com/<country>/song/.../<id>` and album links with a single `?i=<track-id>`
are resolved only through `https://itunes.apple.com/lookup?id=<track-id>&country=<country>`.
The original path storefront wins over unrelated query parameters. The exact
safe-integer track ID must be returned as a song; albums, different IDs and
malformed responses are errors. A valid empty result (or 404) is unavailable.
There is no alternate-country, full-album, URL-title guessing, or paid API fallback.
Use a Spotify song link if the recording is missing from that iTunes storefront.
The source link stays an Apple Music song link, not a provider-returned URL.

iTunes supplies title, the combined artist string, album, duration and track
explicitness (`explicit`, `cleaned`, `notExplicit`); album explicitness is ignored.
Missing optional metadata stays unknown. Artwork is restricted to safe HTTPS
CDN URLs. iTunes does **not** supply ISRCs. Matching still checks full title/artist,
versions, duration and explicitness without fuzzy scoring. When Spotify supplies
an ISRC but iTunes does not, even a unique otherwise-identical candidate needs a
version choice. The new flow lets the submitter make that choice directly by
clicking the result; legacy submitted requests still need the host. This can reduce match coverage
(including differently formatted multi-artist credits). No recording safety rule
is relaxed. New direct Spotify links also wait for a result click; only legacy
submissions retain their existing automatic path.

The [archived iTunes API guidance](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)
quotes approximately 20 requests/minute, subject to change. Existing shared
database submission throttles and durable jobs remain, but **no global iTunes
quota or lookup cache is implemented**. Repeated lookups and different service
instances can collectively exceed that estimate; do not claim quota compliance
or increase traffic without measuring it and addressing that limit.
Each resolve attempt makes one lookup. Explicit 429s retain `Retry-After` in the
durable job (60 seconds if absent/invalid), with `itunes_rate_limited` receipts;
network/5xx/invalid-response errors follow bounded read retries. No in-process
retry, sleep, or silent empty result hides an outage. Transport remains fixed-host,
redirect-rejecting, DNS-vetted, limited to 1 MiB and an 8-second deadline.

### Search and explicit selection API

`POST /api/party/rooms/:id/search` accepts `{ url }`. Signed Telegram session,
exact Origin, CSRF, live room and membership are required; guests use only the
host's server-side credentials. Apple links use exact iTunes track ID/storefront
then Spotify search. Spotify links use direct Spotify lookup, not iTunes.
Both client and server share the strict link parser. Read-only resolution keeps
all existing version/playability checks and returns `{ candidates, expiresAt }`,
with a `selectionToken` on each candidate. It does not store search drafts or
publish search results in the room feed.

Each domain-separated HMAC-signed capability binds the session, room, canonical
source, exact candidate metadata, common search nonce and expiry (at most five
minutes, bounded by session/room expiry). Tokens contain no host credentials and
are kept only in component memory. `POST /rooms/:id/selections` accepts only
`{ selectionToken }`, never trusts client track IDs/metadata, and rechecks expiry,
room and membership under the existing account lock. Request bodies are bounded
to 32 KiB, selection tokens to 30,000 characters; oversized provider metadata is
an explicit error rather than an unusable result.

One common search nonce becomes the existing unique submission key. Concurrent
or repeated clicks on the same candidate return the same request (an overlapping
account operation may return retryable `host_busy`); choosing another candidate
from a consumed search conflicts. No duplicate job or provider write is created.
A fresh deliberate search permits adding the same song again. Selection creates
an `approved` request and one `deliver` job atomically, with no legacy resolver
job. Fresh pre-send recording validation, account serialization, 429 retry and
unknown-write safeguards remain unchanged.

Database throttles limit search to six per participant/room and sixteen per room
per minute; selection has separate limits of eight and eighty respectively.
These limits are shared across instances but are **not a global iTunes quota**
or cache. They also do not replace provider Retry-After handling. The UI cancels
and invalidates old searches on input/room changes or unmount, never auto-retries
a failed search, and gates explicit rate-limit retries. It tracks only selections
made by this mounted form for outcome toasts: polling old/other users' receipts
or reloading does not replay success. Normal results need no second confirmation;
exceptional unknown-delivery recovery still requires host duplicate-risk consent.

### Queue delivery

Committed submissions and approvals create database outbox jobs. Scheduler
dispatches bounded named Cloud Tasks batches and repairs stale dispatch records.
Named-task deduplication handles successful task creation followed by an uncertain
DB update. Worst-case normal submission latency includes the one-minute scheduler
tick; visible Mini App polling is not a background worker.

Session-pinned PostgreSQL advisory locks serialize an account across processes
and instances, including token refresh, moderation, close and delivery. One active
room per account is also enforced by a partial unique index. A sending attempt is
committed **before** the sole Spotify queue POST. No device ID is discovered,
stored or sent by Party; Spotify resolves active playback. Direct links reject relinking
or missing playability evidence. Approval order applies in approval mode; eligible
auto-mode requests use submission order. Pending/unapproved songs do not block
approved requests.

An explicit queue 404 is a known rejection, not an uncertain delivery. It pauses
the room and asks the host to start music in Spotify and tap **Try again**.
That CSRF-protected owner action resumes only playback-unavailable failures
and pending jobs; it cannot bypass an unknown-delivery block. No automatic
repeat occurs while playback is unavailable, and no test track is queued.

Spotify 204 is success without JSON decoding. Explicit 429 responses persist
`Retry-After` in the job, with no in-process sleeping. Read failures have bounded
durable retries. A timeout, uncertain 5xx or unrecorded sending attempt becomes
`failed / delivery_unknown`, blocks the room and is never automatically repeated.
Recovery does not infer idempotency by looking at the current queue. Hosts must
acknowledge the uncertainty before resuming; intentional retry requires a separate
duplicate-risk confirmation and a new attempt. A two-minute settling window blocks
acknowledgement/retry while an abandoned bounded HTTP operation could still be in
flight. Unknown is not "definitely failed".

## Verification

```sh
npm run build
npm test --workspace=@brewtify/spotify
npm test --workspace=api
npm run test:integration --workspace=api
npm run lint --workspace=mini-app
npm run lint:party --workspace=mini-app
npm test --workspace=mini-app
```

The integration suite starts an isolated **native PostgreSQL** binary from the
development-only `embedded-postgres` package, on a free loopback port in a named
temporary `.data/party-test-*` directory, and stops/removes that cluster afterward.
It never contacts `DATABASE_URL` from your environment. It exercises real SQL,
advisory locks (including another Node process), transaction/cascade behavior and
HTTP auth APIs; Spotify provider responses are fixtures, **not live proof**.
Root-only environments must use a non-root test user; the suite never creates
OS users or changes shared database services.

The frontend README describes the development-only visual fixture and unique
preview port. Add `&demo=host` to `/app/?section=party` to use the interactive,
sample-data Host/Guest/Start screens; these reuse the real room components with
a browser-local transport that never calls Party APIs or providers. Production
builds exclude this demo. Production party routes have no fixture identity. Real Telegram
tests require an HTTPS staging deployment/test bot, signed fresh launch data,
secure-cookie behavior, the external browser with a distinct cookie jar and the
actual Spotify-authorized Premium host. Record those results separately before enabling the pilot.

With the visual fixture running at `http://127.0.0.1:5197` and Google Chrome
installed, `npm run test:party-browser` verifies mobile layout, no Library fetch
on Party entry, navigation during Library loading/failure, the disabled gate, and
the slim sample flow, nameless submission/CSRF contract, direct start after
OAuth, reload/reconnect, failed-creation recovery and explicit playback retry
using browser fixtures, not real provider authentication.
Override `PARTY_PREVIEW_URL` or `CHROME_PATH` for another local preview/browser.
The full legacy frontend lint currently has 27 existing errors in untouched files;
the focused `lint:party` gate covers changed frontend code without suppressing them.

### Implementation verification (2026-09-22, updated 2026-09-23)

The isolated worktree passed all five workspace builds, 40 provider/transport
tests, 15 catalog/Telegram tests, 16 native PostgreSQL/HTTP integration scenarios,
17 frontend tests, seven headless Chrome browser checks, targeted frontend lint,
and Terraform initialization/validation without applying infrastructure.
The PostgreSQL suite runs all four migrations and verifies zero Prisma schema drift.
Docker image execution was not available because the local Docker daemon was not
running. No real provider authorization, Telegram client session, Cloud Tasks
dispatch, production migration, or Spotify queue write was performed.

The free iTunes replacement (2026-09-23) passed all five workspace builds,
40 provider/transport tests, 20 catalog/config/Telegram tests, 17 native PostgreSQL
integration scenarios (including durable iTunes retries and host version choice),
18 frontend tests and focused frontend lint. Two public IL-storefront lookups
through the real adapter verified Ensalada and Shivers metadata without contacting
Spotify. The local preview responded over HTTP, but browser regression checks
were blocked before loading a page: system Chrome timed out on launch and cached
headless Chromium crashed with SIGSEGV. No browser pass is claimed for this change.
These checks do not establish live Spotify, signed Telegram or cloud readiness.

The search-and-select follow-up adds native PostgreSQL coverage for read-only
search, session/room/source-bound capabilities, tampering, expiry, revoked
membership, concurrent idempotent clicks, deliberate repeated additions and
recording drift. React DOM tests exercise real components with controlled timers
for debounce, stale responses, shared card markup, direct one-click selection,
confirmed-only one-time toasts, not-found versus errors and expiry. These DOM
tests do not establish browser layout or keyboard behavior. Browser regression
tests were updated, but local launch remains blocked: system Chrome timed out
with EPERM during cleanup, cached headless Chromium 1234 crashed with SIGSEGV,
and cached Chromium 1194 timed out. The HTTP-responsive preview is available
on port 5213; no rendered-browser verification is claimed for this follow-up.
