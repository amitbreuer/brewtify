# Brewtify — Implementation Summary

## What Was Built

Brewtify is a Spotify playlist management service — a "Playlists Brewery" — that lets users create, customize, and auto-refresh playlists via a Telegram Mini App. It runs 24/7 on Fly.io.

---

## Architecture

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
| Backend | Express, grammY, TypeScript | API server + Telegram bot |
| Database | Neon PostgreSQL + Prisma ORM | Users, playlists, schedules |
| Cache | Upstash Redis | Spotify data caching (albums, tracks) |
| Shared Logic | @brewtify/shared | Track selection algorithm, description parsing |
| Deployment | Fly.io (Docker), GitHub Actions | Always-on VM, CI/CD |
| Rate Limiting | p-queue (concurrency + interval) | Spotify API rate limit compliance |

---

## Phase 1: Database & Token Encryption

**Problem:** Tokens were stored as plaintext JSON in `.data/tokens.json`. No persistence across restarts.

**Solution:**
- Set up **Neon PostgreSQL** (free tier, 10 GB)
- Installed **Prisma ORM** with PostgreSQL adapter (`@prisma/adapter-pg`)
- Created schema: `User`, `Playlist`, `ScheduledUpdate`, `UserPreferences` models
- Implemented **AES-256-GCM encryption** with HKDF per-user key derivation
  - Master key stored as environment variable (64 hex chars)
  - Per-user salt ensures identical tokens produce different ciphertexts
  - Each encryption call uses a random 12-byte IV
  - Stored format: `base64(iv + authTag + ciphertext)`
- Built `DbTokenStore` replacing file-based `TokenStore`

**Files created:**
- `projects/api/prisma/schema.prisma`
- `projects/api/src/services/encryption.ts`
- `projects/api/src/services/token-store-db.ts`

---

## Phase 2: Redis Cache Layer

**Problem:** File-based caching in `.cache/` directory. Not persistent in containers, not shareable.

**Solution:**
- Set up **Upstash Redis** (free tier, 10K commands/day)
- Created `RedisCacheService` using `@upstash/redis` (serverless HTTP-based, no connection pool needed)
- Migrated all cache operations from file-based to Redis with TTLs:
  - Artist albums: 60 days
  - Album tracks: 180 days (full album objects via batch API)
  - Followed artists: 5 minutes
  - Playlist metadata: 1 hour
  - Pending OAuth states: 10 minutes
- Replaced in-memory `pendingAuthStore` Map with Redis-backed store (survives restarts)

**Files created:**
- `projects/api/src/services/redis-cache.ts`
- `projects/api/src/services/pending-auth-store.ts`

---

## Phase 3: Scheduling System

**Problem:** Playlist updates only ran via GitHub Actions cron (every 6 days) or manual trigger. No per-playlist control.

**Solution:**
- Installed `node-cron` for in-process scheduling
- Installed `p-queue` for concurrency control (max 5 simultaneous updates)
- Created scheduler service:
  - Runs at midnight UTC daily (`0 0 * * *`)
  - Queries DB for playlists where `nextUpdateAt <= now` and `status = 'active'`
  - Updates playlist contents (shuffled tracks from stored artist IDs)
  - Records `lastUpdatedAt`, calculates `nextUpdateAt`
  - Max 3 retries on failure
- Added Telegram bot commands: `/schedule`, `/pause`, `/resume`, `/status`
- Supports `daily` and `weekly:N` (N = day of week) schedules

**Files created:**
- `projects/api/src/services/scheduler.ts`

---

## Phase 4: Rate Limit Handling

**Problem:** Creating/updating playlists fires many Spotify API calls (fetching albums + tracks for each artist), hitting Spotify's 429 rate limit.

**Solution — 4-pronged approach:**
1. **Retry with exponential backoff** — `makeRequest` catches 429 responses, reads `Retry-After` header, retries up to 3 times
2. **Concurrency limiting** — All Spotify API calls go through a `PQueue` (max 5 concurrent, max 10 per second interval)
3. **Aggressive caching** — Redis caches with long TTLs (album data 6 months, followed artists 5 min) to minimize API calls
4. **Batch API usage** — Uses `GET /albums?ids=...` (up to 20 albums with embedded tracks in 1 call) instead of individual album track fetches

**Impact:** A 5-artist playlist that previously fired ~100+ simultaneous requests now makes ~5–10 rate-limited calls with automatic retry.

---

## Phase 5: Docker & Fly.io Deployment

**Problem:** Service only ran on local machine. Bot went offline when computer slept.

**Solution:**
- Created multi-stage Dockerfile:
  - **Builder stage:** Installs all deps, builds shared package, generates Prisma client, compiles TypeScript
  - **Runner stage:** Production deps only + compiled output
- Configured Fly.io:
  - Always-on (`auto_stop_machines = 'off'`, `min_machines_running = 1`)
  - Health check: `GET /health` every 30 seconds
  - shared-cpu-1x, 256 MB RAM
  - Region: `iad` (US East)
- GitHub Actions auto-deploy on push to `main`

**Files created:**
- `Dockerfile`
- `fly.toml`
- `.dockerignore`
- `.github/workflows/fly-deploy.yml`

---

## Project Structure

```
brewtify/                          # Turborepo monorepo
├── projects/
│   ├── api/                       # Express + grammY backend
│   │   ├── src/
│   │   │   ├── main.ts           # Entry point, DB init, bot start, scheduler
│   │   │   ├── server.ts         # Express setup (CORS, routes, static)
│   │   │   ├── bot.ts            # Telegram bot commands
│   │   │   ├── routes/
│   │   │   │   ├── health.ts     # GET /health
│   │   │   │   ├── auth.ts       # OAuth callback, token refresh
│   │   │   │   └── spotify.ts    # Spotify proxy routes
│   │   │   ├── services/
│   │   │   │   ├── spotify.ts    # Spotify API client (rate-limited)
│   │   │   │   ├── redis-cache.ts    # Redis caching with TTL
│   │   │   │   ├── token-store-db.ts # Encrypted DB token store
│   │   │   │   ├── encryption.ts     # AES-256-GCM encryption
│   │   │   │   ├── pending-auth-store.ts  # Redis OAuth state
│   │   │   │   ├── scheduler.ts      # Cron-based playlist updater
│   │   │   │   └── db.ts            # Prisma client init
│   │   │   ├── types/spotify.ts  # API type definitions
│   │   │   └── utils/env.ts      # Environment variable helper
│   │   └── prisma/schema.prisma  # Database schema
│   ├── mini-app/                  # React Telegram Mini App
│   │   └── src/
│   │       ├── main.tsx          # React entry point
│   │       ├── App.tsx           # Navigation/routing
│   │       ├── lib/api.ts        # Backend API client
│   │       ├── lib/types.ts      # Frontend type definitions
│   │       └── components/       # UI components
│   └── shared/                    # @brewtify/shared library
│       └── src/playlist-updater.ts  # Track selection, description parsing
├── docs/                          # Architecture documentation
├── Dockerfile                     # Multi-stage production build
├── fly.toml                       # Fly.io deployment config
└── turbo.json                     # Turborepo pipeline
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

---

## Cost

| Service | Tier | Monthly Cost |
|---------|------|-------------|
| Fly.io | Free (1 shared VM, 256MB) | $0 |
| Neon PostgreSQL | Free (10 GB) | $0 |
| Upstash Redis | Free (10K cmd/day) | $0 |
| **Total** | | **$0** |
