# React + TypeScript + Vite

## Brewtify Library and Party

The existing Mini App is still served at `/app`. `GET /api/party/config` controls
the Party rollout. When disabled (or unavailable), the original Library UI and
Playlists/Artists navigation remain. When enabled, Library and Party are lazy
feature boundaries: visiting Party never mounts Library or fetches its profile.
Library logout and Party disconnect are separate.
An error boundary around lazy Library content also catches import/render
failures without removing the section navigation. Vite explicitly prebundles
the linked CommonJS `@brewtify/shared` workspace for development-browser imports.

Party supports `?section=party`, Telegram `startapp=party`, and private
`startapp=p_<secret>` invitations. Browser visitors are directed to Telegram.
There is no development identity bypass: Party bootstraps with signed
`Telegram.WebApp.initData`, uses same-origin session cookies, and sends
`X-Party-CSRF` on mutations. Provider credentials never enter the Mini App.

Start party starts Spotify consent when needed, after Premium confirmation.
OAuth opens via Telegram `openLink`; the original Mini App polls its own
authorization transaction rather than assuming the external browser shares
cookies. After consent, the room opens automatically; there is no device picker
or separate create step. Reopening resumes unfinished creation or the existing
room. Room creation is idempotent for the same verified host; failures have an
explicit Start party retry rather than a background mutation-retry loop.
Queue commands omit `device_id` and follow the host's active Spotify playback.
An explicit no-active-playback rejection shows a host-only Try again action
after starting music in Spotify. Unknown delivery outcomes require
explicit duplicate-risk confirmation before a retry.

Feeds poll while visible, merge changed receipts by ID using the returned
cursor, honor `Retry-After`, back off on transient failures, and stop after
closure/expiry or a terminal authorization/membership error. QR invitations
are generated locally with `qrcode`, not through a third-party service.
Guest receipt visibility and all host permissions are enforced by the API.

Host and guest song inputs search complete links after a 500 ms debounce.
Apple Music links resolve through exact-ID/storefront iTunes lookup and then
Spotify search; Spotify links resolve directly. Search never queues a song.
Clicking a result card is the only confirmation and creates a durable addition,
without another Add button, modal or routine host approval. `SongCard` supplies
identical artwork, title, artist and album markup for results and list rows.
Results expire after at most five minutes; edits and navigation invalidate old
responses. An empty completed current search shows **Not found** once, while
provider/auth/rate-limit failures remain errors with explicit retry.

The existing toast provider shows **Added to the queue** only for a selected
request whose polled status confirms Spotify accepted it, never for search or
the initial 202 response. Pending requests show progress; unknown outcomes
retain their warning and host recovery safeguards. Old/other users' receipts
and reloads never replay success toasts.

Validation:

```sh
npm test --workspace=mini-app
npm run lint:party --workspace=mini-app
npm run lint --workspace=mini-app
npm run build --workspace=mini-app
```

Node's built-in tests cover launch/navigation rules, invitation parsing, lazy
Library boundary regressions, changed-feed merging, backoff, signed bootstrap,
cookie/CSRF requests, and non-replayed writes. Real Telegram WebView cookies,
external OAuth return, active-playback targeting, and actual Spotify delivery still
require an authorized integration pilot.
`song-search.test.mjs` uses development-only JSDOM and Vite's TSX loader to test
real React input/click/effect behavior with controlled timers, including stale
responses and confirmed-only toasts. It requires the shared workspace build.
This is DOM-only coverage, not a replacement for browser layout/keyboard checks.

On re-entry, Party first restores `GET /api/party/session`; only a 401 triggers
signed-launch bootstrap. Sessions last one hour, while new signed launches
must be fresh within five minutes. After session expiry, reopen Telegram for
fresh launch data. Feed cursors are opaque revision strings: an unchanged
cursor on an empty page waits for the normal interval, not immediate polling.

### Credential-free navigation preview

```sh
VITE_PARTY_PREVIEW=true npm run dev --workspace=mini-app -- --host 127.0.0.1 --port 5174
```

Open `http://127.0.0.1:5174/app/?section=party` for the Open-in-Telegram
explanation, or `http://127.0.0.1:5174/app/?section=library` for the Library
boundary (an error is expected without its API). Both main tabs remain usable.
The Vite **development-server-only** fixture responds solely to
`GET /api/party/config`. It never creates a session, simulates identity,
intercepts provider authorization, or handles mutations. It is absent from
production builds and `vite preview`, even if the environment flag is set.
Do not treat this visual fixture as a Telegram authentication or host-flow test.

`lint:party` covers all changed frontend source/config files; full `lint` also
reports the repository’s unrelated legacy findings.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
# Interactive Party demo

With `VITE_PARTY_PREVIEW=true` on the Vite development server, open
`/app/?section=party&demo=host` to review the actual slim host room and song
components with sample songs. The preview toolbar switches to Guest view and
Start screen (`demo=start`; old `demo=setup` links also open this screen).
The sample Start party button opens the host room directly, simulating consent
without a device picker. Both hosts and guests paste a complete song link and
click the resulting song card; no song appears in the list merely from typing.
Queue acceptance is simulated after a short delay, rather than claiming success
on click. The **Search / delivery sample** control exposes matching, multiple
versions, not found, rate limited, failed, unknown and pending scenarios in both
views. For example, paste `https://music.apple.com/us/song/123456789`.
There is no approval or display-name form and no room
settings panel. Start party and End party update local sample state.
Reset samples restores the example songs.

The host room uses an accessible end-party icon. Both host and guest rooms omit
the Party title and welcome card, and use the same compact song rows containing
artwork, title, artist and album, without success labels, provider links or
descriptive copy. Pending, failed and ambiguous songs retain the information and
controls needed to avoid silent failures or selecting the wrong recording.
Guests still see only their own songs and never receive host controls.

This is a clearly labeled browser-only demo, not a Telegram session. It never
calls Party APIs, authorizes a provider or queues music. QR links use
`example.invalid` and are not invitations. Both the development flag and `demo`
query parameter are required; the demo is excluded from production builds even
if the preview flag is set during a build. The normal preview without `demo`
still shows the real Open in Telegram boundary.
