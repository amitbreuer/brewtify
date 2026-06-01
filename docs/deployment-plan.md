# Brewtify Deployment Plan

## Current State (as of June 2026)

- Express server + grammY Telegram bot deployed on **Google Cloud Run** (scale-to-zero)
- Telegram bot uses **webhook mode** (not long-polling)
- Tokens stored as **AES-256-GCM encrypted** records in Neon PostgreSQL
- Upstash Redis for caching (albums, tracks, auth state)
- **Cloud Scheduler** triggers playlist updates daily at 00:00 UTC via `POST /cron/update`
- CI/CD: GitHub Actions auto-deploys to Cloud Run on push to `main` (Workload Identity Federation)

---

## Architecture: Cloud Run + Neon + Upstash

```
Google Cloud Run (scale-to-zero, me-west1)
├── Express + grammY bot (webhook mode)
├── Prisma ORM → Neon PostgreSQL (users, tokens, playlists, preferences)
├── Upstash Redis (cached Spotify data — artists, albums, tracks)
└── POST /cron/update (triggered by Cloud Scheduler)
```

### Hosting: **Google Cloud Run** (Scale-to-Zero)

- Containers start on request, shut down when idle
- No cold-start issues for this use case (~2s startup)
- Free tier: 2M requests/month + 360K vCPU-seconds
- Deploy via `gcloud run deploy --source .` (builds Dockerfile in Cloud Build)

### Database: **Neon (PostgreSQL)** — Primary Store

| Aspect | Details |
|--------|---------|
| Free storage | 10 GB |
| Data integrity | FK constraints, ACID |
| ORM | Prisma |
| Stores | Encrypted user tokens, playlist settings, schedules |

### Cache: **Upstash Redis** — Caching Layer

- 10,000 commands/day free, 256 MB storage
- Serverless Redis (HTTP-based) — no connection management
- **Caches:** artist albums (2mo TTL), album tracks (6mo TTL), pending auth state (10min TTL)

---

## Scheduling (Cloud Scheduler)

Replaced in-process `node-cron` with Google Cloud Scheduler:

```
Cloud Scheduler (daily 00:00 UTC)
  │
  └─ POST /cron/update (X-Cron-Secret header)
       │
       ├─ Query: SELECT playlists WHERE next_update_at <= NOW()
       │
       ├─ For each due playlist (concurrency=5 via p-queue):
       │   1. Decrypt user's Spotify tokens
       │   2. Refresh if expired
       │   3. Fetch artist tracks (Redis cache: 90%+ hit rate)
       │   4. Shuffle & select tracks (Fisher-Yates)
       │   5. PUT /playlists/{id}/tracks to Spotify
       │   6. Update next_update_at, last_updated_at
       │
       └─ On failure: retry 3x, then mark 'failed' + store error
```

---

## Token Encryption Strategy

**Algorithm:** AES-256-GCM (authenticated encryption)

```
ENCRYPTION_KEY = env variable (32 bytes, hex-encoded)
Per-user key = HKDF(master_key, user_salt, "brewtify-tokens")
IV = crypto.randomBytes(12) per encryption call
Stored format: base64(iv + authTag + ciphertext)
```

---

## Environment Variables (Production)

Stored in **Google Cloud Secret Manager**, injected at deploy time:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `ENCRYPTION_KEY` | 64-char hex string for AES-256 master key |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis HTTP endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `SPOTIFY_REDIRECT_URI` | OAuth callback URL (Cloud Run domain) |
| `CRON_SECRET` | Secret for Cloud Scheduler authentication |

---

## CI/CD: GitHub Actions → Cloud Run

Workflow: `.github/workflows/cloud-run-deploy.yml`

- Triggered on push to `main`
- Authenticates via **Workload Identity Federation** (no service account key)
- Runs `gcloud run deploy --source .` (builds Dockerfile in Cloud Build)
- Injects secrets from Secret Manager

GitHub repo secrets:
- `GCP_PROJECT_ID` = `brewtify-498108`
- `GCP_SERVICE_ACCOUNT` = `github-deploy@brewtify-498108.iam.gserviceaccount.com`
- `GCP_WORKLOAD_IDENTITY_PROVIDER` = full provider resource name

---

## Cost

| Service | Tier | Monthly Cost |
|---------|------|-------------|
| Cloud Run | Free (scale-to-zero, <2M requests) | $0 |
| Cloud Scheduler | Free (3 jobs free) | $0 |
| Neon PostgreSQL | Free (10 GB) | $0 |
| Upstash Redis | Free (10K cmd/day) | $0 |
| **Total** | | **$0** |

---

## Implementation Phases (Historical)

### Phase 1: Database & ORM Setup ✅
- Prisma ORM with Neon PostgreSQL
- AES-256-GCM encryption for tokens
- Replaced file-based TokenStore with DB-backed encrypted store

### Phase 2: Redis Cache Layer ✅
- Upstash Redis replacing file-based cache
- Pending auth state moved to Redis (10-min TTL)

### Phase 3: Scheduling System ✅
- p-queue concurrency control
- Bot commands: `/schedule`, `/pause`, `/resume`, `/status`

### Phase 4: Cloud Run Migration ✅
- Removed `node-cron` → Cloud Scheduler
- Switched bot to webhook mode
- Deployed to Cloud Run (me-west1)
- CI/CD via Workload Identity Federation
- Destroyed Fly.io app

See `docs/cloud-run-migration.md` for the full migration log.
