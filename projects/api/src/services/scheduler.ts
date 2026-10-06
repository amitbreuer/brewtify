import PQueue from 'p-queue';
import { selectRandomTracks, normalizeSchedule, nextRefreshDate } from '@brewtify/shared';
import { prisma } from './db';
import { spotifyService } from './spotify';
import { getAccessTokenForUser } from '../routes/auth';
import { createLogger } from '../utils/logger';
import { getTap } from '@brewtify/tap';

const log = createLogger('scheduler');

const CONCURRENCY = 5;
const MAX_RETRIES = 3;

export async function processScheduledUpdates() {
  const now = new Date();

  // Find all playlists that are due for update
  const duePlaylists = await prisma.playlist.findMany({
    where: {
      schedule: { not: null },
      status: 'active',
      nextUpdateAt: { lte: now },
    },
    include: { user: true },
  });

  if (duePlaylists.length === 0) {
    log.info('No playlists due for update');
    return;
  }

  log.info(`${duePlaylists.length} playlist(s) due for update`);

  const queue = new PQueue({ concurrency: CONCURRENCY });
  const results: PlaylistUpdateResult[] = [];

  for (const playlist of duePlaylists) {
    queue.add(async () => {
      const result = await updatePlaylist(playlist);
      results.push(result);
    });
  }

  await queue.onIdle();
  log.info('All updates complete');

  // Send a single summary notification with per-playlist results
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  const lines = results.map((r) => {
    const user = r.username ? `@${r.username}` : `user:${r.userId}`;
    if (r.success) {
      return `  ✅ "${r.playlistName}" (${user}) — ${r.trackCount} tracks`;
    }
    return `  ❌ "${r.playlistName}" (${user}) — ${r.error}`;
  });

  const summary = [
    `Scheduled update finished: ${successCount} succeeded, ${failCount} failed`,
    '',
    ...lines,
  ].join('\n');

  getTap().notify({
    type: 'cron.summary',
    message: summary,
    meta: { successCount, failCount, total: duePlaylists.length },
  });
}

interface PlaylistUpdateResult {
  success: boolean;
  playlistName: string;
  userId: string;
  username?: string;
  trackCount?: number;
  error?: string;
}

async function updatePlaylist(playlist: any): Promise<PlaylistUpdateResult> {
  const {
    id,
    spotifyPlaylistId,
    artistIds,
    trackCount,
    user,
    name: playlistName,
    weights: weightsJson,
    eraPreferences: eraPreferencesJson,
  } = playlist;
  const telegramUserId = user.telegramUserId;
  const username = user.telegramUsername;

  if (username) getTap().setUsername(telegramUserId, username);

  const baseResult = { playlistName, userId: telegramUserId, username };

  try {
    const schedule = normalizePlaylistSchedule(playlist);
    if (!schedule) throw new Error('No refresh days selected');
    const accessToken = await getAccessTokenForUser(telegramUserId);
    if (!accessToken) {
      await markFailed(id, 'auth_expired', 'No valid token — user needs to /login again');
      return { ...baseResult, success: false, error: 'token expired' };
    }

    // Fetch tracks per artist so the configured split can be applied
    const artistsTracks = new Map<string, any[]>();
    for (const artistId of artistIds) {
      try {
        const tracks = await spotifyService.getAllArtistTracks(accessToken, artistId);
        if (tracks.length > 0) artistsTracks.set(artistId, tracks);
      } catch (err: any) {
        log.warn(`Failed to fetch tracks for artist ${artistId}`, {
          artistId,
          error: err.message,
        });
      }
    }

    if (artistsTracks.size === 0) {
      await markFailed(id, 'failed', 'No tracks found for configured artists');
      return { ...baseResult, success: false, error: 'no tracks found' };
    }

    const weights = toNumberMap(weightsJson);
    const eraPreferences = toNumberMap(eraPreferencesJson);

    const selectedTracks = selectRandomTracks(artistsTracks, trackCount, {
      weights,
      eraPreferences,
    }).map((t: any) => t.uri ?? `spotify:track:${t.id}`);

    // Replace playlist tracks on Spotify
    await spotifyService.replacePlaylistTracks(accessToken, spotifyPlaylistId, selectedTracks);

    // Success — update schedule
    await prisma.playlist.update({
      where: { id },
      data: {
        lastUpdatedAt: new Date(),
        schedule,
        nextUpdateAt: calculateNextUpdate(schedule),
        failureCount: 0,
        lastError: null,
        status: 'active',
      },
    });

    log.info('Playlist updated successfully', { spotifyPlaylistId, trackCount: selectedTracks.length });
    return { ...baseResult, success: true, trackCount: selectedTracks.length };
  } catch (err: any) {
    log.error('Failed to update playlist', { playlistId: id, error: err.message });

    const newFailureCount = playlist.failureCount + 1;
    if (newFailureCount >= MAX_RETRIES) {
      await markFailed(id, 'failed', err.message);
    } else {
      await prisma.playlist.update({
        where: { id },
        data: {
          failureCount: newFailureCount,
          lastError: err.message,
        },
      });
    }

    return { ...baseResult, success: false, error: err.message };
  }
}

/**
 * Converts a Prisma Json column of `{ artistId: number }` into a Map.
 * Returns undefined when the column is empty so callers fall back to defaults.
 */
export function toNumberMap(json: unknown): Map<string, number> | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const entries = Object.entries(json as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([k, v]) => [k, v as number] as const);
  return entries.length > 0 ? new Map(entries) : undefined;
}

async function markFailed(playlistId: string, status: string, error: string) {
  await prisma.playlist.update({
    where: { id: playlistId },
    data: {
      status,
      lastError: error,
      failureCount: MAX_RETRIES,
    },
  });
}

/** Anchor legacy weekly schedules to their existing due date before advancing them. */
export function normalizePlaylistSchedule(playlist: {
  schedule: string | null;
  nextUpdateAt: Date | null;
  lastUpdatedAt: Date | null;
  createdAt: Date;
}): string | null {
  return normalizeSchedule(playlist.schedule, playlist.nextUpdateAt ?? playlist.lastUpdatedAt ?? playlist.createdAt);
}

export function calculateNextUpdate(schedule: string, now = new Date()): Date {
  return nextRefreshDate(schedule, now);
}
