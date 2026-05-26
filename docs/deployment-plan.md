# Brewtify Deployment Plan

## Current State

- Express server + grammY Telegram bot running locally (long polling)
- Tokens stored as **plaintext JSON** in `.data/tokens.json` (insecure)
- File-based caching in `.cache/` directory
- No persistent database — all state is in-memory or flat files
- No scheduled updates system beyond the GitHub Actions cron

---

## Chosen Architecture: Fly.io + Neon + Upstash

```
Fly.io (free VM, always-on)
├── Express + grammY bot (long polling)
├── Prisma ORM → Neon PostgreSQL (users, tokens, playlists, preferences)
├── Upstash Redis (cached Spotify data — artists, albums, tracks)
└── node-cron (scheduled playlist updates at 00:00 UTC)
```

### Hosting: **Fly.io** (Always-On)

- 3 free VMs (shared-cpu-1x, 256MB RAM each) — bot never sleeps
- Process runs 24/7, no cold starts, no sleep policy
- Unlike Railway (sleeps after 5 min) or Render (sleeps after 15 min),
  Fly.io keeps your app alive permanently
- Deploy via `flyctl` CLI, supports Docker

### Database: **Neon (PostgreSQL)** — Primary Store

| Aspect | PostgreSQL (Neon) | MongoDB (Atlas) |
|--------|-------------------|-----------------|
| Free storage | **10 GB** | 512 MB |
| Data integrity | FK constraints, ACID | Eventual consistency |
| Relationships | Natural (users→playlists) | Manual denormalization |
| Schema enforcement | Strict (catches bugs) | Flexible (allows corruption) |
| TypeScript ORM | Prisma (excellent) | Mongoose |

**Stores:** encrypted user tokens, playlist settings, schedules, user preferences.

### Cache: **Upstash Redis** — Caching Layer

- 10,000 commands/day free, 256 MB storage
- Serverless Redis — no infra management
- **Caches:** artist albums (2mo TTL), album tracks (6mo TTL), playlist metadata (1hr TTL)

---

## Database Schema

Defined in `projects/api/prisma/schema.prisma`:

**Users** — Telegram identity + encrypted Spotify tokens
**Playlists** — Spotify playlist config + schedule fields (merged, no separate schedule table)
**UserPreferences** — genres, moods, favorites, exclusions

Schedule is a field on playlists (not a separate table) because it's 1:1 and
always updates at 00:00 UTC — no per-user time config needed.

---

## Token Encryption Strategy

**Algorithm:** AES-256-GCM (authenticated encryption)

```
ENCRYPTION_KEY = env variable (32 bytes, hex-encoded)
Per-user key = HKDF(master_key, user_salt, "brewtify-tokens")
IV = crypto.randomBytes(12) per encryption call
Stored format: base64(iv + authTag + ciphertext)
```

- AES-256-GCM (not bcrypt) because we need to **decrypt** tokens to use them
- GCM provides encryption + tamper detection
- Per-user salt + HKDF ensures identical tokens produce different ciphertext

---

## Scheduled Updates Flow

```
00:00 UTC — node-cron fires
  │
  ├─ Query: SELECT playlists WHERE schedule IS NOT NULL
  │    AND status = 'active' AND next_update_at <= NOW()
  │
  ├─ For each due playlist (concurrency=5 via p-queue):
  │   1. Decrypt user's Spotify tokens
  │   2. Refresh if expired
  │   3. Fetch artist tracks (Redis cache: 90%+ hit rate)
  │   4. Shuffle & select tracks (Fisher-Yates)
  │   5. PUT /playlists/{id}/tracks to Spotify
  │   6. Update next_update_at, last_updated_at
  │
  └─ On failure: retry 3x, then mark 'failed' + notify user
```

**Scaling:** Sequential handles 1–50 users. p-queue concurrency=5 handles up to ~500 users on the free VM.

---

## Implementation Phases

### Phase 1: Database & ORM Setup ✅ DONE
- [x] Install Prisma ORM (`prisma` + `@prisma/client` + `@prisma/adapter-pg`)
- [x] Define schema.prisma (users, playlists, user_preferences)
- [x] Implement AES-256-GCM encryption service with HKDF per-user key derivation
- [x] Replace file-based `TokenStore` with Prisma-backed encrypted store
- [x] Update auth routes to use async DB token store
- [x] Add graceful shutdown (Prisma disconnect on SIGTERM)
- [x] Verify: TypeScript compiles clean, encryption round-trip works
- [x] Sign up at neon.tech, set DATABASE_URL, run `prisma db push`
- [x] Consolidated `.env` and `.env.local` into single `.env.local` (Prisma config updated to read both)

### Phase 2: Redis Cache Layer ✅ DONE
- [x] Install `@upstash/redis` (serverless, HTTP-based, no connection pooling needed)
- [x] Create `RedisCacheService` (`src/services/redis-cache.ts`) replacing file-based `CacheService`
- [x] Migrate cache keys: artist albums (2mo TTL), album tracks (6mo TTL)
- [x] Move `pendingAuthStore` from in-memory Map to Redis (`src/services/pending-auth-store.ts`, 10-min TTL, survives restarts)
- [x] Update `spotify.ts` to use `redisCacheService` instead of `cacheService`
- [x] Update `bot.ts` and `auth.ts` to use Redis-backed `pendingAuthStore`
- [x] Removed `setTimeout` hack — Redis handles TTL natively
- [x] TypeScript compiles clean
- [ ] **TODO:** Sign up at upstash.com, create Redis DB, set `UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN` in `.env.local`

### Phase 3: Scheduling System ✅ DONE
- [x] Install `node-cron` + `p-queue`
- [x] Implement scheduler service (`src/services/scheduler.ts`): midnight cron checks DB for due updates
- [x] Playlist update flow: decrypt tokens → refresh if expired → fetch tracks (Redis cached) → shuffle → replace on Spotify → update next_update_at
- [x] Concurrency via p-queue (5 parallel updates)
- [x] Retry logic (3 attempts, then mark status='failed' + store error)
- [x] `calculateNextUpdate()` handles 'daily' and 'weekly:N' schedules
- [x] Scheduler started in `main.ts` on app boot
- [x] Bot commands added: `/schedule <name> <daily|weekly:N>`, `/pause <name>`, `/resume <name>`, `/status`
- [x] TypeScript compiles clean

### Phase 4: User Preferences — SKIPPED (for now)

### Phase 5: Dockerize & Deploy to Fly.io ✅ DONE
- [x] Create multi-stage `Dockerfile` (Node 22-slim, build → production)
- [x] Create `fly.toml` (shared-cpu-1x, 256MB, always-on, health check at `/health`)
- [x] Create `.dockerignore` (excludes node_modules, .env files, UI, scripts)
- [x] Verify `npm run build` produces correct `dist/` with Prisma client
- [x] Health check endpoint exists at `GET /health`
- [ ] **TODO:** Install flyctl CLI, run deployment commands (see below)

### Phase 6: CI/CD
- [ ] GitHub Actions: build + deploy on push to main
- [ ] Automated Prisma migrations on deploy
- [ ] Remove old GitHub Actions update-playlists workflow (replaced by in-app scheduler)

---

## Environment Variables (Production)

```env
# Server
PORT=3000
NODE_ENV=production

# Telegram
TELEGRAM_BOT_TOKEN=xxx

# Spotify
SPOTIFY_CLIENT_ID=xxx
SPOTIFY_CLIENT_SECRET=xxx
SPOTIFY_REDIRECT_URI=https://brewtify-bot.fly.dev/callback

# Database (Neon)
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/brewtify?sslmode=require

# Cache (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# Security
ENCRYPTION_KEY=<64-char hex string for AES-256>
```

---

## Cost Summary

| Service | Free Limit | Sufficient? |
|---------|-----------|-------------|
| Fly.io | 3 VMs (256MB, shared CPU) | ✅ Bot + Express on 1 VM |
| Neon (Postgres) | 10 GB, serverless | ✅ More than enough |
| Upstash (Redis) | 10K cmd/day, 256MB | ✅ For caching |
| **Total** | **$0/month** | ✅ |

---

## Migration Path from Current → Production

1. `TokenStore` (file `.data/tokens.json`) → PostgreSQL `users` table + AES-256-GCM ✅
2. `.cache/` directory → Upstash Redis with TTL ✅
3. In-memory `pendingAuthStore` Map → Redis with 10-min TTL ✅
4. GitHub Actions cron → in-app node-cron scheduler (Phase 3)
5. Long polling → (optional) Webhook mode (Phase 5)
