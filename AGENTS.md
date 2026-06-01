# Brewtify

Brewtify is a Spotify playlist management service — a "Playlists Brewery" — that lets users create playlists from their followed artists, auto-refresh them on a schedule, and manage everything via a Telegram Mini App.

## Repository Structure

This is a **TypeScript monorepo** managed with [Turborepo](https://turbo.build/) and npm workspaces. Node.js 22.17 is required (see `.nvmrc`).

```
brewtify/
├── projects/
│   ├── api/          # Backend — Express server + Telegram bot
│   ├── mini-app/     # Frontend — React + Tailwind + Vite (Telegram Mini App)
│   └── shared/       # Shared library (@brewtify/shared)
├── docs/             # Architecture and migration docs
├── .github/workflows # CI/CD (Cloud Run deploy)
├── Dockerfile        # Multi-stage Docker build
├── turbo.json        # Turborepo task configuration
├── tsconfig.json     # Root TypeScript config (ES2022, strict)
└── package.json      # Workspace root
```

## Deployment

Deployed on **Google Cloud Run** (scale-to-zero, ~$0/month for ≤10 users).

- **Service URL:** `https://brewtify-133698158612.me-west1.run.app`
- **Region:** `me-west1`
- **CI/CD:** GitHub Actions auto-deploys on push to `main` via Workload Identity Federation (keyless)
- **Scheduling:** Cloud Scheduler sends `POST /cron/update` daily at 00:00 UTC
- **Bot mode:** Webhook (not long-polling) — compatible with scale-to-zero

External dependencies:
- **Neon PostgreSQL** — users, encrypted tokens, playlist schedules
- **Upstash Redis** — caching (albums, tracks, auth state)
- **Spotify Web API** — playlist management
- **Telegram Bot API** — bot commands + Mini App

## Projects

### `projects/api` — Backend API

An **Express 5** server that handles the Telegram bot webhook, Spotify API proxy, and scheduled updates. Runs on port 3000.

**Key technologies:** Express, grammY (Telegram bot), Prisma ORM, `@upstash/redis`, cors, AES-256-GCM encryption.

**Source layout:**

| Path | Purpose |
|------|---------|
| `src/main.ts` | Entry point — starts server, sets up bot webhook |
| `src/server.ts` | Express app setup — CORS, routes, static file serving |
| `src/bot.ts` | grammY bot commands + `setupBotWebhook()` (webhook mode) |
| `src/routes/health.ts` | `GET /health` |
| `src/routes/auth.ts` | `GET /login`, `GET /callback` — Spotify OAuth flow |
| `src/routes/spotify.ts` | Spotify proxy routes — profile, playlists, artists, tracks |
| `src/routes/cron.ts` | `POST /cron/update` — Cloud Scheduler endpoint (X-Cron-Secret auth) |
| `src/services/spotify.ts` | `SpotifyService` class — Spotify Web API wrapper with caching |
| `src/services/scheduler.ts` | `processScheduledUpdates()` — finds due playlists and refreshes them |
| `src/services/token-store-db.ts` | Encrypted token storage (Prisma + AES-256-GCM) |
| `src/services/redis-cache.ts` | Upstash Redis cache with TTL |
| `src/utils/env.ts` | Environment variable helper |
| `src/utils/logger.ts` | Structured JSON logger |

**Authentication flow:**
1. User sends `/login` in Telegram → bot generates Spotify OAuth URL
2. User authorizes → redirected to `/callback` → tokens encrypted and stored in PostgreSQL
3. Mini App sends `X-Telegram-User-Id` header → backend decrypts and refreshes tokens as needed

### `projects/mini-app` — Frontend (Telegram Mini App)

A **React 19** single-page application with **Tailwind CSS**, bundled with **Vite 8**. Served as static files from the API at `/app`.

**Features:**
- Displays user profile and all playlists
- Browse and search followed artists (with debounced search)
- Create new playlists from selected artists with configurable track count
- Schedule automatic playlist refresh (daily/weekly)
- Manually trigger playlist refresh

### `projects/shared` — Shared Library

Published as `@brewtify/shared`. Contains the track selection algorithm reused by the API.

**Exports:**
- `selectRandomTracks()` — shuffles and selects tracks from multiple artists (Fisher-Yates)
- TypeScript interfaces: `Track`, `PlaylistConfig`, `SpotifyClient`

## Auto-Update System

Playlists opt into automatic refresh via the scheduling system (stored in PostgreSQL):

1. **Cloud Scheduler** fires `POST /cron/update` daily at 00:00 UTC (authenticated via `X-Cron-Secret` header)
2. The endpoint calls `processScheduledUpdates()` which queries the DB for playlists where `next_update_at <= NOW()`
3. For each due playlist: decrypt tokens → refresh if expired → fetch artist tracks (Redis cached) → shuffle → replace playlist on Spotify → update `next_update_at`
4. Concurrency controlled via p-queue (5 parallel updates)

## Development

### Prerequisites

- Node.js 22.17+ (see `.nvmrc`)
- npm 10.9.2+ (specified as `packageManager`)

### Getting Started

```bash
# Install dependencies
npm install

# Start API and Mini App in development mode
npm run dev

# Build all projects
npm run build
```

### Environment Variables

**`projects/api/.env.local`** (not committed):
- `DATABASE_URL` — Neon PostgreSQL connection string
- `ENCRYPTION_KEY` — 64-char hex string for AES-256 master key
- `UPSTASH_REDIS_REST_URL` — Upstash Redis HTTP endpoint
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis auth token
- `TELEGRAM_BOT_TOKEN` — Telegram Bot API token
- `SPOTIFY_CLIENT_ID` — Spotify app client ID
- `SPOTIFY_CLIENT_SECRET` — Spotify app client secret
- `SPOTIFY_REDIRECT_URI` — OAuth callback URL
- `CRON_SECRET` — Secret for Cloud Scheduler authentication

### Spotify API Scopes Used

`user-read-private`, `user-read-email`, `playlist-read-private`, `playlist-modify-private`, `playlist-modify-public`, `user-follow-read`

## Caching Strategy

Uses **Upstash Redis** (HTTP-based, serverless):
- **Artist albums:** 2-month TTL
- **Album tracks:** 6-month TTL
- **Pending auth state:** 10-minute TTL

## Key Design Decisions

- **Scale-to-zero:** Cloud Run only runs when handling requests — $0/month for low traffic.
- **Webhook bot:** grammY bot uses webhook mode (not long-polling) to work with Cloud Run's ephemeral containers.
- **External scheduler:** Cloud Scheduler replaces in-process node-cron — triggers updates even when no container is running.
- **Encrypted tokens:** AES-256-GCM with per-user HKDF key derivation — tokens encrypted at rest in PostgreSQL.
- **No session cookies:** Auth is per-Telegram-user via `X-Telegram-User-Id` header — tokens stored server-side in the DB.
- **Monorepo with shared logic:** The `@brewtify/shared` package ensures playlist-update logic is consistent.
