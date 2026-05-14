# Brewtify

Brewtify is a Spotify playlist management web application — a "Playlists Brewery" — that lets users create playlists from their followed artists and automatically keep them refreshed with randomized tracks.

## Repository Structure

This is a **TypeScript monorepo** managed with [Turborepo](https://turbo.build/) and npm workspaces. Node.js 22.17 is required (see `.nvmrc`).

```
brewtify/
├── projects/
│   ├── api/          # Backend — Fastify server
│   ├── ui/           # Frontend — Vanilla TypeScript + Vite
│   └── shared/       # Shared library (playlist-updater logic)
├── scripts/          # Standalone Node.js scripts
├── .github/workflows # CI / scheduled automation
├── turbo.json        # Turborepo task configuration
├── tsconfig.json     # Root TypeScript config (ES2022, strict)
└── package.json      # Workspace root
```

## Projects

### `projects/api` — Backend API

A **Fastify** (v5) server that proxies and orchestrates Spotify Web API calls. Runs on port 3000 by default.

**Key technologies:** Fastify, `@fastify/cors`, `@fastify/cookie`, `@fastify/session`, `@fastify/swagger` + `@fastify/swagger-ui`, dotenv, ts-node, nodemon.

**Source layout:**

| Path | Purpose |
|------|---------|
| `src/main.ts` | Entry point — loads env, starts the server |
| `src/server.ts` | Fastify app setup — CORS, sessions, Swagger, route registration |
| `src/routes/health.ts` | `GET /health` |
| `src/routes/auth.ts` | `POST /auth/session`, `GET /auth/status`, `POST /auth/logout` — session-based auth with automatic token refresh |
| `src/routes/spotify.ts` | Spotify proxy routes — profile, playlists, followed artists, artist tracks, create playlist, add tracks, update description |
| `src/routes/update-playlist.ts` | `POST /api/playlists/:playlistId/update` — re-fills a playlist with shuffled tracks from encoded artist IDs |
| `src/services/spotify.ts` | `SpotifyService` class — wraps all Spotify Web API calls, handles OAuth token exchange/refresh, adds file-based caching for albums and tracks |
| `src/services/cache.ts` | `CacheService` — file-based JSON cache in `.cache/` directory (MD5-hashed keys, optional TTL) |
| `src/types/spotify.ts` | TypeScript interfaces for Spotify entities |
| `src/utils/env.ts` | Environment variable helper with required/default support |

**Authentication flow:**
1. The frontend performs Spotify OAuth (PKCE) and obtains tokens directly.
2. Tokens are sent to `POST /auth/session` and stored in a server-side session (cookie-based via `@fastify/session`).
3. Subsequent API calls use the session; the backend auto-refreshes expired tokens.

**API documentation:** Available at `/docs` (Swagger UI) when the server is running.

### `projects/ui` — Frontend

A **vanilla TypeScript** single-page application bundled with **Vite** (v7). Runs on port 5173 during development.

**Source layout:**

| Path | Purpose |
|------|---------|
| `index.html` | Main HTML page with inline CSS (Spotify dark theme) |
| `src/main.ts` | Entry point — handles OAuth callback, session check, app bootstrap |
| `src/auth.ts` | PKCE code verifier/challenge generation, OAuth redirect, token exchange |
| `src/api.ts` | API client — all `fetch` calls to the backend (`http://127.0.0.1:3000`) |
| `src/playlists.ts` | Playlist and artist list management, create-playlist workflow, artist search |
| `src/ui.ts` | DOM manipulation — profile display, playlist/artist element creation, form state |
| `src/types.ts` | TypeScript types for Spotify entities (frontend-specific) |
| `src/constants.ts` | Spotify client ID and redirect URI |

**Features:**
- Displays user profile and all playlists
- Browse and search followed artists (with debounced search)
- Create new playlists from selected artists with configurable track count (20–100)
- Toggle auto-update on playlists via checkbox in the UI
- Manually trigger playlist refresh (🔄 button) for auto-update-enabled playlists

### `projects/shared` — Shared Library

Published as `@brewtify/shared`. Contains playlist update logic reused by both the API and the standalone update script.

**Exports:**
- `parseArtistIdsFromDescription()` — extracts artist IDs from playlist descriptions using the `[Auto-update: id1,id2,id3]` format (with fallback to legacy `ARTISTS:` format)
- `selectRandomTracks()` — shuffles and selects tracks from multiple artists
- `fillPlaylist()` — orchestrates fetching artist tracks and updating a playlist
- TypeScript interfaces: `Track`, `PlaylistConfig`, `SpotifyClient`

## Auto-Update System

Playlists opt into automatic refresh by encoding artist IDs in the playlist description:

```
[Auto-update: artistId1,artistId2,artistId3]
```

When auto-update runs, it:
1. Finds all user playlists with the `[Auto-update:` marker
2. Parses artist IDs from each playlist's description
3. Fetches up to 20 albums per artist, then up to 30 tracks per album
4. Shuffles all collected tracks and replaces the playlist contents (maintaining the original track count)

### `scripts/update-playlists.js`

A standalone Node.js script (no TypeScript compilation needed) that runs the auto-update logic. Uses file-based caching (`.cache/` directory) with 2-month TTL for album data and permanent caching for track data.

**Environment variables required:**
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`
- `PLAYLIST_ID` (optional — update a single playlist instead of all)
- `GH_PAT` (optional — for auto-rotating the refresh token secret in GitHub)

### `.github/workflows/update-playlists.yml`

A **GitHub Actions** workflow that runs the update script on a schedule (every 6 days) or manually via `workflow_dispatch`. It:
- Restores/saves the `.cache` directory across runs
- Supports an optional `playlist_id` input for targeted updates
- Auto-updates the `SPOTIFY_REFRESH_TOKEN` GitHub secret if Spotify rotates the token

## Development

### Prerequisites

- Node.js 22.17+ (see `.nvmrc`)
- npm 10.9.2+ (specified as `packageManager`)

### Getting Started

```bash
# Install dependencies
npm install

# Start both API and UI in development mode
npm run dev

# Build all projects
npm run build
```

The `dev` command uses Turborepo to run both projects in parallel:
- **API:** `nodemon --watch src --exec ts-node src/main.ts` (auto-restarts on changes)
- **UI:** `vite` dev server with HMR

### Environment Variables

**Root `.env`:**
- `PORT` — API server port (default: 3000)

**`projects/api/.env.local`** (not committed):
- `SPOTIFY_CLIENT_ID` — Spotify app client ID
- `SPOTIFY_CLIENT_SECRET` — Spotify app client secret
- `SESSION_SECRET` — Secret for cookie signing

### Spotify API Scopes Used

`user-read-private`, `user-read-email`, `playlist-read-private`, `playlist-modify-private`, `playlist-modify-public`, `user-follow-read`

## Caching Strategy

Both the API server and the standalone script use file-based caching (`.cache/` directory):
- **Artist albums:** Cached with a 2-month TTL
- **Album tracks:** Cached permanently (track listings don't change)
- Cache keys are MD5-hashed and stored as individual JSON files

## Key Design Decisions

- **Session-based auth:** Tokens are stored server-side in sessions rather than in the browser, improving security.
- **PKCE flow:** The frontend handles the Spotify OAuth PKCE flow directly, then passes tokens to the backend for session storage.
- **No database:** All persistent state is encoded in Spotify playlist descriptions (artist IDs) and file-based cache. No external database is required.
- **Monorepo with shared logic:** The `@brewtify/shared` package ensures playlist-update logic is consistent between the web app and the scheduled script.
