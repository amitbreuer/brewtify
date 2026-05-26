# Brewtify — Implementation Summary

## What Is Brewtify

Brewtify is a Spotify playlist management service — a "Playlists Brewery" — that lets users create playlists from their followed artists, auto-refresh them on a schedule, and manage everything via a Telegram Mini App. It runs 24/7 on Fly.io.

---

## Architecture Overview

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────┐
│   Telegram   │◄─────►│   Fly.io VM      │◄─────►│  Neon PostgreSQL│
│   Users      │       │   (Node.js)      │       │  (Free tier)    │
└──────────────┘       │                  │       └─────────────────┘
                       │  - Express API   │
┌──────────────┐       │  - grammY Bot    │       ┌─────────────────┐
│  Mini App    │◄─────►│  - Scheduler     │◄─────►│  Upstash Redis  │
│  (React SPA) │       │  - Rate Limiter  │       │  (Free tier)    │
└──────────────┘       └──────────────────┘       └─────────────────┘
                               │
                               ▼
                       ┌──────────────────┐
                       │   Spotify API    │
                       │  (Web API v1)    │
                       └──────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19, Tailwind CSS, Vite 8 | Telegram Mini App (SPA) |
| Backend | Express 5, grammY, TypeScript | API server + Telegram bot |
| Database | Neon PostgreSQL + Prisma ORM | Users, playlists, schedules |
| Cache | Upstash Redis (HTTP-based) | Spotify data caching (albums, tracks, auth state) |
| Shared Logic | @brewtify/shared | Track selection algorithm, description parsing |
| Deployment | Fly.io (Docker), GitHub Actions | Always-on VM, CI/CD |
| Rate Limiting | p-queue (concurrency + interval) | Spotify API rate limit compliance |
| Logging | Structured JSON logger | Observability (request tracing, error reporting) |

---

## Feature Flows

### 1. Authentication

**User action:** User types `/login` in the Telegram bot, or opens the Mini App and sees the login screen.

**Complete flow:**

```
User                    Telegram Bot / Mini App           Backend (auth.ts)              Spotify              Database
 │                              │                              │                           │                    │
 │──── /login ─────────────────►│                              │                           │                    │
 │                              │──── GET /login?telegramUserId ──►│                       │                    │
 │                              │                              │── generate state UUID      │                    │
 │                              │                              │── store in Redis ──────────────────────────────────►│ (pending-auth:{state} → userId, 10min TTL)
 │                              │                              │── build Spotify auth URL   │                    │
 │◄──── redirect to Spotify ────┤◄──── 302 redirect ──────────┤                           │                    │
 │                              │                              │                           │                    │
 │──── approve scopes ──────────────────────────────────────────────────────────────────────►│                   │
 │◄──── redirect to /callback ──────────────────────────────────────────────────────────────┤                   │
 │                              │                              │                           │                    │
 │──── GET /callback?code&state ────────────────────────────────►│                         │                    │
 │                              │                              │── lookup userId from Redis │                    │
 │                              │                              │── exchange code for tokens ──►│                 │
 │                              │                              │◄── {access_token, refresh_token, expires_in} ──┤ │
 │                              │                              │── encrypt tokens (AES-256-GCM) ─────────────────►│ (User record)
 │                              │                              │── delete pending auth state ─────────────────────►│
 │◄──── "✅ Logged in!" ────────┤◄──── HTML response ──────────┤                           │                    │
```

**Token refresh (transparent to user):**
Every API call goes through `getAccessTokenForUser()` which checks if the token is expired (with 60-second buffer). If expired:
1. A per-user lock prevents duplicate refreshes (concurrent requests wait for the first refresh to complete)
2. Calls Spotify's token refresh endpoint
3. Stores new encrypted tokens in the database
4. If refresh fails → deletes stored tokens, user must `/login` again

**Security details:**
- Tokens encrypted with **AES-256-GCM** using HKDF per-user key derivation
- Master key is an environment variable (64 hex chars)
- Each user has a unique salt → identical tokens produce different ciphertexts
- Each encryption uses a random 12-byte IV
- Stored format: `base64(iv + authTag + ciphertext)`

---

### 2. Playlist Creation

**User action:** In the Mini App, user selects artists → configures track count + era preference → taps "Create Playlist".

**Complete flow:**

```
Mini App (CreatePlaylist.tsx)          Backend (spotify routes)         SpotifyService              Spotify API         Redis Cache
 │                                          │                               │                        │                    │
 │── fetchFollowedArtists() ───────────────►│                               │                        │                    │
 │                                          │── getFollowedArtists() ───────►│                        │                    │
 │                                          │                               │── check cache ──────────────────────────────►│
 │                                          │                               │◄── HIT (within 5min) ──────────────────────┤
 │◄── artist list ──────────────────────────┤◄──────────────────────────────┤  (or MISS → fetch from Spotify → cache)    │
 │                                          │                               │                        │                    │
 │ [User selects artists, count, era]       │                               │                        │                    │
 │                                          │                               │                        │                    │
 │── fetchAllArtistTracks(artistId) ───────►│ (for each artist, parallel)   │                        │                    │
 │                                          │── getAllArtistTracks() ────────►│                        │                    │
 │                                          │                               │── getArtistAlbums() ───►│ (cache: 60 days)  │
 │                                          │                               │◄── [album1..album20] ──┤                    │
 │                                          │                               │                        │                    │
 │                                          │                               │── getAlbumsBatch() ────►│                    │
 │                                          │                               │   (check each album ───────────────────────►│)
 │                                          │                               │   (batch uncached: GET /albums?ids=...) ───►│
 │                                          │                               │◄── full albums w/ tracks ──────────────────┤
 │                                          │                               │── cache each album ────────────────────────►│ (6 months)
 │                                          │                               │                        │                    │
 │◄── tracks[] with release_date ───────────┤◄──────────────────────────────┤                        │                    │
 │                                          │                               │                        │                    │
 │ [Apply era weighting + artist weights]   │                               │                        │                    │
 │ [Shuffle and select final trackUris]     │                               │                        │                    │
 │                                          │                               │                        │                    │
 │── createPlaylist(userId, name, desc) ───►│                               │                        │                    │
 │                                          │── POST /users/{id}/playlists ─────────────────────────────►│               │
 │◄── {id, name, ...} ─────────────────────┤◄──────────────────────────────────────────────────────────┤               │
 │                                          │                               │                        │                    │
 │── addTracksToPlaylist(id, uris[]) ──────►│                               │                        │                    │
 │                                          │── chunk uris into 100s ───────►│                        │                    │
 │                                          │   POST /playlists/{id}/tracks (chunk 1) ──────────────────►│               │
 │                                          │   POST /playlists/{id}/tracks (chunk 2) ──────────────────►│               │
 │◄── success ──────────────────────────────┤◄──────────────────────────────┤                        │                    │
```

**Description encoding:** The playlist description embeds metadata for auto-update:
```
[Auto-update: artistId1,artistId2:50%,artistId3|era=75|count=100]
```
This encodes: which artists, their weight percentages, era preference, and target track count.

**Era weighting:** The frontend applies a sigmoid-based weighting to each track's `release_date`. An era value of 0 = prefer older music, 100 = prefer newer music, 50 = no preference.

**Input validation:**
- Playlist name: max 100 characters
- Track URIs: max 500 per request
- Artist IDs: max 50 per request
- Limit parameter: clamped between 1-50

---

### 3. Playlist Refresh (Manual)

**User action:** In the Mini App playlist list, user taps the 🔄 button on a playlist that has `[Auto-update: ...]` in its description.

**Complete flow:**

```
Mini App (PlaylistList.tsx)        Backend (POST /playlists/:id/update)      SpotifyService             Spotify API
 │                                      │                                        │                        │
 │── [Confirm dialog] ────────────►     │                                        │                        │
 │── updatePlaylist(playlistId) ───────►│                                        │                        │
 │                                      │── getPlaylist(token, id) ──────────────►│── GET /playlists/{id} ─►│
 │                                      │◄── playlist with description ──────────┤◄────────────────────────┤
 │                                      │                                        │                        │
 │                                      │── parseArtistIdsFromDescription()      │                        │
 │                                      │   → extracts [id1, id2, id3]          │                        │
 │                                      │── parseWeightsFromDescription()        │                        │
 │                                      │   → extracts {id2: 50}               │                        │
 │                                      │                                        │                        │
 │                                      │── for each artist (sequential):        │                        │
 │                                      │   getAllArtistTracks(token, artistId) ─►│                        │
 │                                      │   [uses cache + batch API + queue]     │◄── tracks ────────────┤
 │                                      │                                        │                        │
 │                                      │── selectRandomTracks(artistsTracks,    │                        │
 │                                      │     targetCount, weights)             │                        │
 │                                      │   [from @brewtify/shared]             │                        │
 │                                      │   → shuffle, respect weights, select   │                        │
 │                                      │                                        │                        │
 │                                      │── replacePlaylistTracks(id, uris) ────►│                        │
 │                                      │   PUT /playlists/{id}/tracks (100) ──────────────────────────────►│
 │                                      │   POST /playlists/{id}/tracks (rest) ────────────────────────────►│
 │                                      │                                        │                        │
 │◄── {success, trackCount, artistCount} ┤                                       │                        │
 │── [refresh playlist list] ──────────►│                                        │                        │
```

**Key behavior:**
- Artists are processed sequentially (not parallel) to stay within rate limits
- If one artist fails, the others still proceed (logged as warning, not fatal)
- `selectRandomTracks()` uses Fisher-Yates shuffle and respects per-artist weight percentages
- Target track count defaults to the playlist's current total if not encoded

---

### 4. Scheduled Auto-Updates

**User action:** User types `/schedule "My Mix" daily` or `/schedule "Chill Vibes" weekly:5` (5 = Friday) in Telegram.

**Scheduling flow:**

```
Telegram Bot (bot.ts)                  Database (Prisma)
 │                                          │
 │── parse: playlistName + schedule ────────│
 │── prisma.user.findUnique(telegramUserId) │
 │── prisma.playlist.findFirst(name match)  │
 │                                          │
 │── calculateNextUpdate('daily')           │
 │   → tomorrow at 00:00 UTC               │
 │── calculateNextUpdate('weekly:5')        │
 │   → next Friday at 00:00 UTC            │
 │                                          │
 │── prisma.playlist.update({               │
 │     schedule: 'daily',                   │
 │     nextUpdateAt: <calculated>,          │
 │     status: 'active',                    │
 │     failureCount: 0                      │
 │   }) ───────────────────────────────────►│
 │                                          │
 │── reply: "✅ Scheduled! Next: Jan 15"    │
```

**Cron execution (daily at 00:00 UTC):**

```
Scheduler (scheduler.ts)              Database                SpotifyService          Spotify API
 │                                      │                        │                      │
 │── cron triggers at 00:00 UTC         │                        │                      │
 │── prisma.playlist.findMany({         │                        │                      │
 │     schedule != null,                │                        │                      │
 │     status: 'active',                │                        │                      │
 │     nextUpdateAt <= now              │                        │                      │
 │   }) ───────────────────────────────►│                        │                      │
 │◄── duePlaylists[] ──────────────────┤                        │                      │
 │                                      │                        │                      │
 │── PQueue(concurrency: 5)             │                        │                      │
 │   for each playlist:                 │                        │                      │
 │     ├── getAccessTokenForUser() ─────────────────────────────►│                      │
 │     │   (auto-refresh if expired)    │                        │                      │
 │     ├── getAllArtistTracks() ────────────────────────────────►│── Spotify API calls ─►│
 │     ├── shuffle + select tracks      │                        │                      │
 │     ├── replacePlaylistTracks() ────────────────────────────►│── PUT/POST ──────────►│
 │     │                                │                        │                      │
 │     ├── SUCCESS:                     │                        │                      │
 │     │   prisma.playlist.update({     │                        │                      │
 │     │     lastUpdatedAt: now,        │                        │                      │
 │     │     nextUpdateAt: next,        │                        │                      │
 │     │     failureCount: 0            │                        │                      │
 │     │   }) ─────────────────────────►│                        │                      │
 │     │                                │                        │                      │
 │     └── FAILURE (after 3 retries):   │                        │                      │
 │         prisma.playlist.update({     │                        │                      │
 │           status: 'failed',          │                        │                      │
 │           lastError: err.message,    │                        │                      │
 │           failureCount: 3            │                        │                      │
 │         }) ─────────────────────────►│                        │                      │
```

**Bot management commands:**
- `/pause "My Mix"` → sets `status: 'paused'` (scheduler skips it)
- `/resume "My Mix"` → sets `status: 'active'`, recalculates `nextUpdateAt`
- `/status` → lists all scheduled playlists with status icons: 🟢 active, ⏸️ paused, 🔴 failed, 🔑 auth_expired

---

### 5. Rate Limiting & Caching

**Problem:** Creating a playlist from 5 artists could fire 100+ Spotify API calls simultaneously (20 albums × track fetches per artist), hitting Spotify's rolling 30-second rate limit window.

**Solution — 4-layer defense:**

```
                    ┌─────────────────────────────────────────┐
                    │         Layer 1: Request Queue           │
                    │  PQueue(concurrency:5, intervalCap:10)   │
                    │  Max 5 concurrent, max 10 per second     │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │         Layer 2: Redis Cache             │
                    │  album-full:{id}      → 6 months        │
                    │  artist-albums:{id}   → 60 days         │
                    │  followed-artists:{h} → 5 minutes       │
                    │  (cache hit = zero API calls)            │
                    └────────────────┬────────────────────────┘
                                     │ (cache miss)
                    ┌────────────────▼────────────────────────┐
                    │         Layer 3: Batch API               │
                    │  GET /albums?ids=id1,id2,...,id20         │
                    │  (1 call for 20 albums instead of 20)    │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────▼────────────────────────┐
                    │         Layer 4: Retry with Backoff      │
                    │  On 429: read Retry-After header         │
                    │  Sleep for N seconds                     │
                    │  Retry up to 3 times                     │
                    └─────────────────────────────────────────┘
```

**Impact comparison (5-artist playlist):**

| Metric | Before | After |
|--------|--------|-------|
| Simultaneous API calls | ~100+ | Max 5 |
| Total API calls (cold cache) | ~100 | ~10 |
| Total API calls (warm cache) | ~100 | 0-2 |
| Rate limit errors | Frequent | Rare (retried automatically) |

**Cache resilience:**
- Redis errors are non-fatal — the app gracefully degrades to hitting Spotify directly
- A consecutive error counter escalates from `warn` to `error` log level after 3 failures
- On success, the counter resets

---

## System Components

### Express API Server (`projects/api/src/server.ts`)

The HTTP server that powers both the Mini App and the bot's backend operations.

**Responsibilities:**
- CORS enforcement (whitelist: Fly.io domain + localhost)
- Request logging middleware (method, path, status, duration, user ID)
- Static file serving for the Mini App (`/app/*`)
- JSON body parsing for API routes

**Route groups:**
| Prefix | File | Purpose |
|--------|------|---------|
| `/health` | `routes/health.ts` | Health check for Fly.io (returns 200) |
| `/login`, `/callback` | `routes/auth.ts` | Spotify OAuth flow |
| `/api/*` | `routes/spotify.ts` | All authenticated Spotify operations |

---

### Telegram Bot (`projects/api/src/bot.ts`)

A grammY-based bot that provides a conversational interface for schedule management.

**Commands:**
| Command | Action |
|---------|--------|
| `/start` | Welcome message with feature list |
| `/login` | Initiates Spotify OAuth, opens browser |
| `/playlists` | Lists user's Spotify playlists |
| `/schedule "name" daily\|weekly:N` | Schedules automatic playlist refresh |
| `/pause "name"` | Pauses a scheduled playlist |
| `/resume "name"` | Resumes a paused playlist |
| `/status` | Shows all scheduled playlists + their status |

**Startup behavior:** Bot startup is non-fatal — if another instance is already polling (e.g., Fly.io production while developing locally), it logs a warning and continues without the bot.

---

### Spotify Service (`projects/api/src/services/spotify.ts`)

The core integration layer with Spotify's Web API. All external Spotify calls flow through this service.

**Key methods:**
| Method | Spotify Endpoint | Cache | Notes |
|--------|-----------------|-------|-------|
| `getProfile()` | GET /me | None | User identity |
| `getPlaylists()` | GET /me/playlists | None | Always fresh |
| `getPlaylist()` | GET /playlists/{id} | None | Need current description |
| `getFollowedArtists()` | GET /me/following | 5 min | Reduces repeat loads |
| `getArtistAlbums()` | GET /artists/{id}/albums | 60 days | Albums rarely change |
| `getAlbumsBatch()` | GET /albums?ids=... | 6 months | Tracks never change |
| `getAllArtistTracks()` | (orchestrates above) | Via sub-calls | Main entry point |
| `createPlaylist()` | POST /users/{id}/playlists | None | Write operation |
| `addTracksToPlaylist()` | POST /playlists/{id}/tracks | None | Chunked (100 per call) |
| `replacePlaylistTracks()` | PUT + POST /playlists/{id}/tracks | None | Full replacement |

---

### Redis Cache (`projects/api/src/services/redis-cache.ts`)

HTTP-based Redis via Upstash (no connection pool needed — each call is a standalone HTTP request).

**Cache keys and TTLs:**
| Key Pattern | TTL | Data |
|-------------|-----|------|
| `artist-albums:{artistId}:{limit}:{offset}` | 60 days | Album list metadata |
| `album-full:{albumId}` | 6 months | Full album object with tracks |
| `followed-artists:{tokenHash}:{limit}:{after}` | 5 min | User's followed artist list |
| `pending-auth:{state}` | 10 min | OAuth state → telegramUserId mapping |

**Error handling:** Graceful degradation — cache failures are logged with escalating severity but never crash the request. The app functions without Redis (just slower due to more Spotify API calls).

---

### Scheduler (`projects/api/src/services/scheduler.ts`)

An in-process cron job that refreshes playlists according to their schedule.

**Configuration:**
- Cron: `0 0 * * *` (midnight UTC daily)
- Concurrency: 5 playlists updated simultaneously via PQueue
- Max retries: 3 per playlist before marking as `failed`

**Playlist states:**
| Status | Meaning | Scheduler behavior |
|--------|---------|-------------------|
| `active` | Normal operation | Picked up when `nextUpdateAt <= now` |
| `paused` | User paused | Skipped |
| `failed` | 3 consecutive failures | Skipped, user notified via `/status` |
| `auth_expired` | Token refresh failed | Skipped, user must `/login` |

---

### Shared Library (`projects/shared`)

Published as `@brewtify/shared`, used by both the API and the scheduler.

**Exports:**
| Function | Purpose |
|----------|---------|
| `parseArtistIdsFromDescription(desc)` | Extracts artist IDs from `[Auto-update: id1,id2,id3]` format |
| `parseWeightsFromDescription(desc)` | Extracts per-artist weight percentages |
| `selectRandomTracks(artistsTracks, count, weights)` | Fisher-Yates shuffle with weighted artist selection |

---

### Mini App Frontend (`projects/mini-app`)

A React 19 SPA served by the backend at `/app`. Opened inside Telegram as a Web App.

**Views:**
| View | Component | Features |
|------|-----------|----------|
| Login | `LoginScreen.tsx` | Directs user to `/login` |
| Home | `PlaylistList.tsx` + `Profile.tsx` | Lists playlists, shows 🔄 and ❌ buttons |
| Create | `CreatePlaylist.tsx` | Artist selection, track count, era preference, weights |
| Detail | `PlaylistDetail.tsx` | Playlist track listing |

**UX patterns:**
- Confirmation dialogs before destructive actions (refresh, delete)
- Toast notifications for errors (not blocking `alert()`)
- Loading states for async operations
- Debounced artist search

---

### Structured Logger (`projects/api/src/utils/logger.ts`)

All backend logging goes through a centralized logger that outputs:
- **Production:** JSON lines (for Fly.io log aggregation)
- **Development:** Human-readable format with timestamps and context

**Log levels:** `debug` → `info` → `warn` → `error` (controlled by `LOG_LEVEL` env var)

**Context tags:** Every logger instance is scoped to a module (e.g., `spotify-service`, `scheduler`, `auth`, `http`) for easy filtering.

**Request logging middleware** logs every HTTP request with: method, path, status code, duration (ms), and user identifier.

---

## Database Schema

```prisma
model User {
  id                    String     @id @default(uuid())
  telegramUserId        String     @unique
  encryptedAccessToken  String?
  encryptedRefreshToken String?
  tokenExpiresAt        BigInt?
  encryptionSalt        String
  playlists             Playlist[]
  createdAt             DateTime   @default(now())
  updatedAt             DateTime   @updatedAt
}

model Playlist {
  id                String    @id @default(uuid())
  spotifyPlaylistId String
  name              String
  artistIds         String[]
  trackCount        Int       @default(60)
  schedule          String?           // 'daily' | 'weekly:N'
  status            String    @default("active")
  nextUpdateAt      DateTime?
  lastUpdatedAt     DateTime?
  failureCount      Int       @default(0)
  lastError         String?
  user              User      @relation(fields: [userId], references: [id])
  userId            String
}
```

---

## Environment Variables (Production)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `ENCRYPTION_KEY` | 64-char hex string for AES-256 master key |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis HTTP endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `SPOTIFY_REDIRECT_URI` | OAuth callback URL (Fly.io domain) |
| `CORS_ORIGINS` | Additional allowed origins (comma-separated) |
| `LOG_LEVEL` | Logging verbosity: debug/info/warn/error |
| `PORT` | Server port (default: 5173) |

---

## Deployment

### Docker Multi-Stage Build

```dockerfile
# Stage 1: Builder
- Install all dependencies (including devDeps)
- Build shared package
- Generate Prisma client
- Compile TypeScript (API + Mini App)

# Stage 2: Runner
- Production dependencies only
- Copy compiled output
- Copy Prisma client + schema
- Copy Mini App dist (static files)
```

### Fly.io Configuration

- **Machine:** shared-cpu-1x, 256 MB RAM
- **Mode:** Always-on (`auto_stop_machines = 'off'`, `min_machines_running = 1`)
- **Health check:** `GET /health` every 30 seconds
- **Region:** `iad` (US East)
- **CI/CD:** Auto-deploy on push to `main` via GitHub Actions

---

## Cost

| Service | Tier | Monthly Cost |
|---------|------|-------------|
| Fly.io | Free (1 shared VM, 256MB) | $0 |
| Neon PostgreSQL | Free (10 GB) | $0 |
| Upstash Redis | Free (10K cmd/day) | $0 |
| **Total** | | **$0** |
