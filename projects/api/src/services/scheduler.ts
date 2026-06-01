import PQueue from 'p-queue';
import { prisma } from './db';
import { spotifyService } from './spotify';
import { getAccessTokenForUser } from '../routes/auth';
import { createLogger } from '../utils/logger';

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

  for (const playlist of duePlaylists) {
    queue.add(() => updatePlaylist(playlist));
  }

  await queue.onIdle();
  log.info('All updates complete');
}

async function updatePlaylist(playlist: any) {
  const { id, spotifyPlaylistId, artistIds, trackCount, user } = playlist;
  const telegramUserId = user.telegramUserId;

  try {
    // Get a valid access token (auto-refreshes if expired)
    const accessToken = await getAccessTokenForUser(telegramUserId);
    if (!accessToken) {
      await markFailed(id, 'auth_expired', 'No valid token — user needs to /login again');
      return;
    }

    // Fetch tracks from all artists
    const allTracks: string[] = [];
    for (const artistId of artistIds) {
      const tracks = await spotifyService.getAllArtistTracks(accessToken, artistId);
      allTracks.push(...tracks.map((t) => `spotify:track:${t.id}`));
    }

    if (allTracks.length === 0) {
      await markFailed(id, 'failed', 'No tracks found for configured artists');
      return;
    }

    // Shuffle (Fisher-Yates) and select
    for (let i = allTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
    }
    const selectedTracks = allTracks.slice(0, trackCount);

    // Replace playlist tracks on Spotify
    await spotifyService.replacePlaylistTracks(accessToken, spotifyPlaylistId, selectedTracks);

    // Success — update schedule
    await prisma.playlist.update({
      where: { id },
      data: {
        lastUpdatedAt: new Date(),
        nextUpdateAt: calculateNextUpdate(playlist.schedule!),
        failureCount: 0,
        lastError: null,
        status: 'active',
      },
    });

    log.info('Playlist updated successfully', { spotifyPlaylistId, trackCount: selectedTracks.length });
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
  }
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

/**
 * Calculate the next update time based on the schedule string.
 * - 'daily' → tomorrow at 00:00 UTC
 * - 'weekly:N' → next day N (0=Sun..6=Sat) at 00:00 UTC
 */
export function calculateNextUpdate(schedule: string): Date {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  if (schedule === 'daily') {
    return tomorrow;
  }

  if (schedule.startsWith('weekly:')) {
    const targetDay = parseInt(schedule.split(':')[1], 10); // 0=Sun..6=Sat
    const currentDay = now.getUTCDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7; // Always schedule for next week
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntil));
  }

  // Fallback: tomorrow
  return tomorrow;
}
