# Migration: Fly.io → Google Cloud Run

**Date:** June 1, 2026  
**Goal:** Move from an always-on Fly.io VM ($0–5/month) to Cloud Run with scale-to-zero ($0/month for ~10 users).

## Motivation

The app doesn't need to run 24/7. It only serves:
- Telegram bot webhook requests (on-demand)
- Mini-app API calls (on-demand)
- A daily cron job to refresh playlists

Cloud Run charges only for actual request time, making it effectively free for low-traffic apps.

---

## Architecture Changes

| Component | Before (Fly.io) | After (Cloud Run) |
|-----------|-----------------|-------------------|
| Hosting | Always-on VM | Scale-to-zero container |
| Scheduler | `node-cron` (in-process) | Cloud Scheduler → HTTP POST |
| Bot mode | Long-polling (`bot.start()`) | Webhook (`webhookCallback`) |
| Deploy | `fly deploy` on push | `gcloud run deploy --source` via GitHub Actions |
| External deps | Neon Postgres, Upstash Redis | Unchanged |

---

## Code Changes

### New files
- **`projects/api/src/routes/cron.ts`** — `POST /cron/update` endpoint protected by `X-Cron-Secret` header, calls `processScheduledUpdates()`
- **`.github/workflows/cloud-run-deploy.yml`** — CI/CD using Workload Identity Federation
- **`.gcloudignore`** — controls what gets uploaded to Cloud Build

### Modified files
- **`projects/api/src/main.ts`** — removed `startScheduler()`, removed `bot.start()`, added `setupBotWebhook(app)`
- **`projects/api/src/bot.ts`** — added `setupBotWebhook()` using grammy's `webhookCallback('express')`
- **`projects/api/src/services/scheduler.ts`** — removed `node-cron` import and `startScheduler()` function, kept `processScheduledUpdates()`
- **`projects/api/src/server.ts`** — added `cronRoutes`, updated CORS origins from Fly.io to Cloud Run URL, fixed SPA catch-all to not serve `index.html` for asset URLs (file extension check)
- **`projects/api/package.json`** — removed `node-cron` and `@types/node-cron`

### Deleted files
- `.github/workflows/fly-deploy.yml`
- `fly.toml`
- `projects/api/.fly/functions.cache.js`

---

## GCP Infrastructure Setup

### Project info
- **Project name:** brewtify
- **Project ID:** `brewtify-498108`
- **Project number:** `133698158612`
- **Region:** `me-west1`
- **Service URL:** `https://brewtify-133698158612.me-west1.run.app`

### 1. Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  --project=brewtify-498108
```

### 2. Create GitHub deploy service account

```bash
gcloud iam service-accounts create github-deploy \
  --display-name="GitHub Actions Deploy" \
  --project=brewtify-498108
```

### 3. Set up Workload Identity Federation (keyless auth from GitHub Actions)

```bash
# Create pool
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --display-name="GitHub Actions Pool" \
  --project=brewtify-498108

# Create OIDC provider
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='amitbreuer/brewtify'" \
  --project=brewtify-498108

# Allow GitHub to impersonate the SA
gcloud iam service-accounts add-iam-policy-binding \
  github-deploy@brewtify-498108.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/133698158612/locations/global/workloadIdentityPools/github-pool/attribute.repository/amitbreuer/brewtify" \
  --project=brewtify-498108
```

### 4. Grant IAM roles to `github-deploy` SA

```bash
# Roles needed for `gcloud run deploy --source`
for role in roles/run.admin roles/artifactregistry.writer roles/cloudbuild.builds.editor \
            roles/storage.admin roles/secretmanager.secretAccessor roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding brewtify-498108 \
    --member="serviceAccount:github-deploy@brewtify-498108.iam.gserviceaccount.com" \
    --role="$role" --quiet
done

# Also grant admin on the specific Artifact Registry repo
gcloud artifacts repositories add-iam-policy-binding cloud-run-source-deploy \
  --location=me-west1 \
  --project=brewtify-498108 \
  --member="serviceAccount:github-deploy@brewtify-498108.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.admin"

# Allow github-deploy to act as the compute SA (needed for Cloud Run revision)
gcloud iam service-accounts add-iam-policy-binding \
  133698158612-compute@developer.gserviceaccount.com \
  --project=brewtify-498108 \
  --member="serviceAccount:github-deploy@brewtify-498108.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### 5. Grant IAM roles to default compute SA (runtime)

```bash
for role in roles/secretmanager.secretAccessor roles/storage.admin \
            roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding brewtify-498108 \
    --member="serviceAccount:133698158612-compute@developer.gserviceaccount.com" \
    --role="$role" --quiet
done
```

### 6. Store secrets in Secret Manager

```bash
for secret in DATABASE_URL SPOTIFY_CLIENT_ID SPOTIFY_CLIENT_SECRET \
              ENCRYPTION_KEY UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN \
              TELEGRAM_BOT_TOKEN CRON_SECRET SPOTIFY_REDIRECT_URI; do
  echo -n "<value>" | gcloud secrets create $secret --data-file=- --project=brewtify-498108
done
```

### 7. First deploy (manual, before CI/CD was working)

```bash
# Build Docker image via Cloud Build
gcloud builds submit --tag me-west1-docker.pkg.dev/brewtify-498108/cloud-run-source-deploy/brewtify \
  --project brewtify-498108

# Deploy to Cloud Run
gcloud run deploy brewtify \
  --image me-west1-docker.pkg.dev/brewtify-498108/cloud-run-source-deploy/brewtify \
  --region me-west1 \
  --project brewtify-498108 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 300 \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,SPOTIFY_CLIENT_ID=SPOTIFY_CLIENT_ID:latest,SPOTIFY_CLIENT_SECRET=SPOTIFY_CLIENT_SECRET:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest,UPSTASH_REDIS_REST_URL=UPSTASH_REDIS_REST_URL:latest,UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest,TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest,CRON_SECRET=CRON_SECRET:latest,SPOTIFY_REDIRECT_URI=SPOTIFY_REDIRECT_URI:latest"
```

### 8. Set Telegram bot webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://brewtify-133698158612.me-west1.run.app/bot/webhook"
```

### 9. Create Cloud Scheduler job

```bash
gcloud scheduler jobs create http brewtify-daily-update \
  --location=me-west1 \
  --schedule="0 0 * * *" \
  --uri="https://brewtify-133698158612.me-west1.run.app/cron/update" \
  --http-method=POST \
  --headers="X-Cron-Secret=<CRON_SECRET_VALUE>" \
  --time-zone="UTC" \
  --project=brewtify-498108
```

### 10. GitHub repository secrets

Added via GitHub Settings → Secrets and variables → Actions:
- `GCP_PROJECT_ID` = `brewtify-498108`
- `GCP_SERVICE_ACCOUNT` = `github-deploy@brewtify-498108.iam.gserviceaccount.com`
- `GCP_WORKLOAD_IDENTITY_PROVIDER` = full provider resource name

---

## Issues Encountered & Fixes

### 1. `gcloud run deploy --source` uses Buildpacks instead of Dockerfile
**Problem:** Even with a Dockerfile present, `--source` defaulted to Buildpacks.  
**Fix:** Built separately with `gcloud builds submit --tag` then deployed with `--image`.  
**Note:** This was only for the first manual deploy; CI/CD uses `--source` which does pick up the Dockerfile.

### 2. Cloud Run reserved `PORT` env var
**Error:** `The following reserved env names were provided: PORT`  
**Fix:** Removed `PORT=3000` from `--set-env-vars`. Cloud Run injects PORT automatically.

### 3. Secret Manager permission denied
**Error:** Compute SA couldn't access secrets.  
**Fix:** `gcloud projects add-iam-policy-binding` with `roles/secretmanager.secretAccessor` for the compute SA.

### 4. Mini-app white screen — CSS MIME type error
**Problem:** SPA catch-all (`/app/{*splat}`) served `index.html` for CSS/JS asset requests (returning `text/html`).  
**Fix:** Added file extension check before the fallback — return 404 for paths matching `/\.\w+$/`.

### 5. Mini-app white screen — CORS blocking API calls
**Problem:** `ALLOWED_ORIGINS` only included the old Fly.io URL. Cloud Run origin was rejected.  
**Fix:** Updated `ALLOWED_ORIGINS` to include `https://brewtify-133698158612.me-west1.run.app`.

### 6. Bot still using Fly.io redirect URI
**Problem:** Telegram webhook was empty — the old Fly.io instance was still handling bot commands via long-polling with the old `SPOTIFY_REDIRECT_URI`.  
**Fix:** Set the Telegram webhook to the Cloud Run URL.

### 7. Spotify "redirect_uri not matching configuration"
**Problem:** `SPOTIFY_REDIRECT_URI` env var wasn't set in Cloud Run secrets initially.  
**Fix:** Created the secret and added it to the deploy config. Also added the URI to the Spotify Developer Dashboard.

### 8. GitHub Actions — Artifact Registry permission denied
**Error:** `github-deploy` SA couldn't push to Artifact Registry.  
**Fix:** Granted `roles/artifactregistry.admin` directly on the `cloud-run-source-deploy` repository resource.

### 9. GitHub Actions — Cloud Run deploy permission denied
**Error:** Generic `PERMISSION_DENIED` on `gcloud run deploy`.  
**Fix:** Added `roles/cloudbuild.builds.editor` and `roles/iam.serviceAccountUser` (to act as the compute SA that runs the revision).

### 10. `gcloud run services logs read` crashes
**Problem:** User's gcloud CLI version has a bug — `TypeError: sequence item 1: expected str instance, NoneType found`.  
**Workaround:** Used `gcloud logging read` with resource filters instead.

---

## Final State

| Component | Status |
|-----------|--------|
| Cloud Run service | ✅ Live at `https://brewtify-133698158612.me-west1.run.app` |
| Telegram bot webhook | ✅ Responding to commands |
| Mini-app | ✅ Working in Telegram |
| Cloud Scheduler | ✅ Daily at 00:00 UTC |
| CI/CD (GitHub Actions) | ✅ Auto-deploys on push to main |
| Fly.io | 🗑️ Destroyed |
| Spotify Dashboard | ✅ Redirect URI updated |

---

## Cost

With ~10 users and daily cron: **$0/month** (within Cloud Run free tier of 2M requests + 360K vCPU-seconds).
