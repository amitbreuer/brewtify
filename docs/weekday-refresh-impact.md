# Selected weekdays: implementation impact

Design preview: `docs/weekday-refresh-options.html`. Option 2 has been implemented in playlist settings and creation, with backend validation and legacy schedule compatibility. No database schema migration is required.

## Recommended approach

Keep the existing nullable `Playlist.schedule` text field. Store a canonical value such as `days:0,2,4` (Sunday, Tuesday, Thursday; 0=Sunday through 6=Saturday). Store `null` for None. Selecting all seven days means every day. This supports the requested feature without a database schema migration or a new scheduler job.

Continue using 00:00 UTC on selected days, matching the current daily Cloud Scheduler trigger. Display UTC clearly: dates shown in the user's local timezone can differ. Local-time scheduling would be additional scope, requiring timezone storage and scheduling changes.

## Backend changes required

- Introduce one schedule parser/normalizer and formatter, shared by API routes, bot, scheduler, and frontend where practical. Reject malformed values rather than falling back to tomorrow. Validate unique integers 0–6; serialize in sorted order. Treat an empty UI selection as `null`, not `days:`.
- Validate schedules in `POST /api/playlists` **before** creating the Spotify playlist, and in `PATCH /api/playlists/:playlistId/settings`. The current routes accept schedules without validation. Keep the existing string/null API shape with the new encoding, and return canonical values through settings GET.
- Replace the interval-only logic in `calculateNextUpdate()` with the earliest selected weekday strictly after the current time, at 00:00 UTC. Use an injectable reference time for deterministic tests. Keep legacy parsing during rollout.
- Use that same calculation after successful scheduled updates, manual refresh, settings changes, and Telegram `/resume`. None clears `nextUpdateAt`; enabling refresh continues to set active status and reset failure state as it does today.
- Update Telegram `/schedule` validation/help and `/status` descriptions. The bot currently accepts only `daily` and `weekly:N`, and status labels any non-daily value as “Weekly”. Preserve `/pause` and `/resume` semantics.
- The due-playlist query (`schedule != null`, active status, `nextUpdateAt <= now`) and concurrency limit can remain. The daily Cloud Scheduler job already visits every day, so it needs no change.

The existing scheduler catches up overdue playlists even if execution occurs on a non-selected day. Retaining that behavior means selected weekdays define intended refresh dates, with late execution possible after outages. Strictly skipping missed dates would require a separate behavior change.

## Database and existing schedules

No schema migration is required for the recommended text encoding. `nextUpdateAt`, `lastUpdatedAt`, status fields, and the due-date index remain useful as-is. Update the Prisma field comment to document the new representation.

For compatibility, parse existing values into day selections:

| Existing value | Weekday selection |
| --- | --- |
| `null` | None |
| `daily` | All seven days |
| `weekly:N` | Day N |
| `weekly` | UTC weekday of existing `nextUpdateAt` |

Plain `weekly` currently means seven days from when the schedule is saved or a refresh runs; it has no fixed weekday in the stored string. Use the existing next due date to preserve its intended upcoming day. If that is missing, use the UTC weekday of `lastUpdatedAt`, then `createdAt` as a deterministic fallback. This conversion locks a weekly schedule to a weekday instead of letting manual refresh shift it.

Read legacy values and write canonical `days:...` values on save. An optional data backfill can canonicalize the rest after backend compatibility is deployed. Preserve existing due dates and paused/failed/auth-expired states during backfill; do not reactivate playlists. Recalculate future dates through the new logic after the next successful refresh.

An alternative is a typed `refreshDays Int[]` database column with an empty array for None. That would require a Prisma/SQL migration, backfill, API changes, and a transition plan for old consumers. It is cleaner if richer scheduling is planned, but not necessary for this request.

## Frontend implementation

- Replaced `SCHEDULE_OPTIONS` with weekday data and a reusable selector used in both `PlaylistDetail.tsx` and `CreatePlaylist.tsx`.
- Keep visible labels `S M T W T F S` in Sunday-first order, with full day names for accessible labels/tooltips and `aria-pressed` for selection.
- Replaced the detail screen's Daily/Weekly/Off summary with explicit selected days, Every day, or None. That summary currently mislabels `weekly:N` schedules as Off.
- Preserve the existing draft/save/cancel behavior and show a clear None state. For options that restore days after turning off, draft-only memory needs no DB field; remembering days after saving None and reopening would require separate persisted preferences.
- Read existing values through the compatibility parser; save `null` or a canonical weekday schedule. The API types can retain `schedule?: string | null` for this approach, ideally narrowing it through a shared schedule type.

## Verification for implementation

Test weekday calculation across Saturday/Sunday, month/year boundaries, leap dates, midnight, one/all selected days, manual refresh, and legacy weekly conversion. Verify malformed input returns 400 before Spotify side effects, None clears the next due date, save/cancel round trips, and bot pause/resume/status work with weekday schedules. Confirm mobile layout and keyboard/screen-reader operation of repeated day initials.

## Validation commands

```sh
npm run build
npm test --workspace @brewtify/shared
npm run test:schedule --workspace api
npm run test:refresh --workspace mini-app
```

The selector restores its draft selection when toggled back on, keeps at least one day while enabled, and saves `null` when disabled. On a new or disabled playlist, enabling initially selects the current UTC weekday; the user can change it before saving.
