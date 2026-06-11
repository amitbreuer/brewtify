import { Router, Request, Response, NextFunction } from 'express';
import { spotifyService } from '../services/spotify';
import { getAccessTokenForUser } from './auth';
import { selectRandomTracks } from '@brewtify/shared';
import { prisma } from '../services/db';
import { calculateNextUpdate } from '../services/scheduler';
import { createLogger } from '../utils/logger';
import { getTap } from '@brewtify/tap';

const log = createLogger('spotify-routes');

export const spotifyRoutes = Router();

// Extend Request to carry the Spotify token and user context
interface AuthenticatedRequest extends Request {
  spotifyToken: string;
  telegramUserId: string;
}

/** Extract a single route parameter as string (Express 5 types params as string | string[]) */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// Middleware: extract Telegram user ID and resolve Spotify access token
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const telegramUserId = req.headers['x-telegram-user-id'] as string | undefined;

  if (!telegramUserId) {
    res.status(401).json({ error: 'Missing X-Telegram-User-Id header' });
    return;
  }

  const accessToken = await getAccessTokenForUser(telegramUserId);
  if (!accessToken) {
    res.status(401).json({ error: 'Not authenticated. Use /login in the Telegram bot first.' });
    return;
  }

  // Populate tap username from DB
  const user = await prisma.user.findUnique({ where: { telegramUserId }, select: { telegramUsername: true } });
  if (user?.telegramUsername) getTap().setUsername(telegramUserId, user.telegramUsername);

  (req as AuthenticatedRequest).spotifyToken = accessToken;
  (req as AuthenticatedRequest).telegramUserId = telegramUserId;
  next();
}

spotifyRoutes.use('/api', requireAuth);

// GET /api/profile
spotifyRoutes.get('/api/profile', async (req: Request, res: Response) => {
  try {
    const profile = await spotifyService.getProfile((req as AuthenticatedRequest).spotifyToken);
    res.json(profile);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to fetch profile', { error: message });
    getTap().notify({
      type: 'error.general',
      userId: (req as AuthenticatedRequest).telegramUserId,
      message: `Profile fetch failed: ${message}`,
    });
    res.status(500).json({ error: message });
  }
});

// GET /api/playlists
spotifyRoutes.get('/api/playlists', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 50);
    const data = await spotifyService.getPlaylists((req as AuthenticatedRequest).spotifyToken, limit);

    // Enrich with managed flag from DB
    const telegramUserId = (req as AuthenticatedRequest).telegramUserId;
    if (telegramUserId && data.items) {
      const user = await prisma.user.findUnique({ where: { telegramUserId } });
      if (user) {
        const spotifyIds = data.items.map((p: any) => p.id);
        const managed = await prisma.playlist.findMany({
          where: { userId: user.id, spotifyPlaylistId: { in: spotifyIds } },
          select: { spotifyPlaylistId: true },
        });
        const managedSet = new Set(managed.map((m) => m.spotifyPlaylistId));
        data.items = data.items.map((p: any) => ({ ...p, managed: managedSet.has(p.id) }));
      }
    }

    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to fetch playlists', { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/playlists/:playlistId
spotifyRoutes.get('/api/playlists/:playlistId', async (req: Request, res: Response) => {
  try {
    const playlist = await spotifyService.getPlaylist(
      (req as AuthenticatedRequest).spotifyToken,
      param(req, 'playlistId')
    );
    res.json(playlist);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to fetch playlist', { playlistId: param(req, 'playlistId'), error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/artists/search?q=...&limit=...
spotifyRoutes.get('/api/artists/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query || query.trim().length === 0) {
      res.status(400).json({ error: 'q query param required' });
      return;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);
    const data = await spotifyService.searchArtists((req as AuthenticatedRequest).spotifyToken, query, limit);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to search artists', { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/artists/suggested — get suggested artists based on followed artists' genres
spotifyRoutes.get('/api/artists/suggested', async (req: Request, res: Response) => {
  try {
    const token = (req as AuthenticatedRequest).spotifyToken;
    const genreFilter = req.query.genre as string | undefined;

    // Fetch all followed artists
    const allFollowed: any[] = [];
    let after: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const data = await spotifyService.getFollowedArtists(token, 50, after);
      allFollowed.push(...data.items);
      after = data.next || undefined;
      hasMore = data.next !== null;
    }

    if (allFollowed.length === 0) {
      res.json({ items: [] });
      return;
    }

    const followedIds = new Set(allFollowed.map((a: any) => a.id));
    const seenIds = new Set<string>();
    const candidates: any[] = [];

    if (genreFilter) {
      // Search a specific genre
      try {
        const results = await spotifyService.searchArtists(token, `genre:"${genreFilter}"`, 50);
        for (const artist of results.items) {
          if (!followedIds.has(artist.id) && !seenIds.has(artist.id)) {
            seenIds.add(artist.id);
            candidates.push({ ...artist, matchedGenre: genreFilter });
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        log.warn(`Failed to search artists for genre "${genreFilter}"`, { genre: genreFilter, error: msg });
      }

      // Sort by popularity, pick 10 randomly from top 30 (weighted by popularity)
      candidates.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
      const pool = candidates.slice(0, 30);
      const picked: any[] = [];
      while (picked.length < 10 && pool.length > 0) {
        const totalPop = pool.reduce((sum, a) => sum + (a.popularity ?? 1), 0);
        let rand = Math.random() * totalPop;
        for (let i = 0; i < pool.length; i++) {
          rand -= pool[i].popularity ?? 1;
          if (rand <= 0) {
            picked.push(pool.splice(i, 1)[0]);
            break;
          }
        }
      }
      res.json({ items: picked });
    } else {
      // Pick 5 random genres weighted by frequency
      const genreCount = new Map<string, number>();
      for (const artist of allFollowed) {
        for (const genre of artist.genres || []) {
          genreCount.set(genre, (genreCount.get(genre) || 0) + 1);
        }
      }

      if (genreCount.size === 0) {
        res.json({ items: [] });
        return;
      }

      const genreEntries = [...genreCount.entries()];
      const totalWeight = genreEntries.reduce((sum, [, count]) => sum + count, 0);
      const selectedGenres: string[] = [];
      const usedIndices = new Set<number>();

      while (selectedGenres.length < Math.min(5, genreEntries.length)) {
        let rand = Math.random() * totalWeight;
        for (let i = 0; i < genreEntries.length; i++) {
          if (usedIndices.has(i)) continue;
          rand -= genreEntries[i][1];
          if (rand <= 0) {
            selectedGenres.push(genreEntries[i][0]);
            usedIndices.add(i);
            break;
          }
        }
      }

      // Search for artists in selected genres
      for (const genre of selectedGenres) {
        try {
          const results = await spotifyService.searchArtists(token, `genre:"${genre}"`, 20);
          for (const artist of results.items) {
            if (!followedIds.has(artist.id) && !seenIds.has(artist.id)) {
              seenIds.add(artist.id);
              candidates.push({ ...artist, matchedGenre: genre });
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          log.warn(`Failed to search artists for genre "${genre}"`, { genre, error: msg });
        }
      }

      // Pick results with genre diversity using weighted random selection
      const byGenre = new Map<string, any[]>();
      for (const artist of candidates) {
        const list = byGenre.get(artist.matchedGenre) || [];
        list.push(artist);
        byGenre.set(artist.matchedGenre, list);
      }

      // Sort each genre's artists by popularity
      for (const [, artists] of byGenre) {
        artists.sort((a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0));
      }

      // Round-robin: pick 1 randomly (weighted by popularity) from each genre, repeat until 10
      const suggestions: any[] = [];
      const genreKeys = [...byGenre.keys()];
      let round = 0;
      while (suggestions.length < 10 && genreKeys.length > 0) {
        const emptyGenres: number[] = [];
        for (let g = 0; g < genreKeys.length; g++) {
          if (suggestions.length >= 10) break;
          const pool = byGenre.get(genreKeys[g])!;
          if (pool.length === 0) {
            emptyGenres.push(g);
            continue;
          }
          // Weighted random pick from this genre's remaining pool
          const slice = pool.slice(0, Math.max(5 - round, 2));
          const totalPop = slice.reduce((sum: number, a: any) => sum + (a.popularity ?? 1), 0);
          let rand = Math.random() * totalPop;
          for (let i = 0; i < slice.length; i++) {
            rand -= slice[i].popularity ?? 1;
            if (rand <= 0) {
              suggestions.push(slice[i]);
              pool.splice(i, 1);
              break;
            }
          }
        }
        // Remove exhausted genres
        for (let i = emptyGenres.length - 1; i >= 0; i--) {
          genreKeys.splice(emptyGenres[i], 1);
        }
        round++;
      }

      res.json({ items: suggestions.slice(0, 10) });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to fetch suggested artists', { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/artists/following/check?ids=id1,id2
spotifyRoutes.get('/api/artists/following/check', async (req: Request, res: Response) => {
  try {
    const ids = (req.query.ids as string || '').split(',').filter(Boolean);
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids query param required' });
      return;
    }
    if (ids.length > 50) {
      res.status(400).json({ error: 'Maximum 50 artist IDs per request' });
      return;
    }
    const results = await spotifyService.checkFollowingArtists((req as AuthenticatedRequest).spotifyToken, ids);
    res.json(ids.map((id, i) => ({ id, following: results[i] })));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to check following status', { error: message });
    res.status(500).json({ error: message });
  }
});

// PUT /api/artists/follow — follow artists
spotifyRoutes.put('/api/artists/follow', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' });
      return;
    }
    if (ids.length > 50) {
      res.status(400).json({ error: 'Maximum 50 artist IDs per request' });
      return;
    }
    await spotifyService.followArtists((req as AuthenticatedRequest).spotifyToken, ids);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to follow artists', { error: message });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/artists/follow — unfollow artists
spotifyRoutes.delete('/api/artists/follow', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids must be a non-empty array' });
      return;
    }
    if (ids.length > 50) {
      res.status(400).json({ error: 'Maximum 50 artist IDs per request' });
      return;
    }
    await spotifyService.unfollowArtists((req as AuthenticatedRequest).spotifyToken, ids);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to unfollow artists', { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/artists?ids=id1,id2,id3 — get multiple artists by IDs
spotifyRoutes.get('/api/artists', async (req: Request, res: Response) => {
  try {
    const ids = (req.query.ids as string || '').split(',').filter(Boolean);
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids query param required' });
      return;
    }
    if (ids.length > 50) {
      res.status(400).json({ error: 'Maximum 50 artist IDs per request' });
      return;
    }
    const artists = await spotifyService.getArtists((req as AuthenticatedRequest).spotifyToken, ids);
    res.json(artists);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to fetch artists', { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/artists/followed
spotifyRoutes.get('/api/artists/followed', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 50);
    const after = req.query.after as string | undefined;
    const data = await spotifyService.getFollowedArtists((req as AuthenticatedRequest).spotifyToken, limit, after);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to fetch followed artists', { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/artists/:artistId/tracks
spotifyRoutes.get('/api/artists/:artistId/tracks', async (req: Request, res: Response) => {
  try {
    const tracks = await spotifyService.getAllArtistTracks(
      (req as AuthenticatedRequest).spotifyToken,
      param(req, 'artistId')
    );
    res.json(tracks);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to fetch artist tracks', { artistId: param(req, 'artistId'), error: message });
    res.status(500).json({ error: message });
  }
});

// POST /api/playlists — create a new playlist and save settings to DB
spotifyRoutes.post('/api/playlists', async (req: Request, res: Response) => {
  try {
    const { userId, name, description, artistIds, trackCount, weights, eraPreference, eraPreferences, schedule } = req.body;
    if (!userId || !name) {
      res.status(400).json({ error: 'userId and name are required' });
      return;
    }
    if (name.length > 100) {
      res.status(400).json({ error: 'Playlist name must be 100 characters or less' });
      return;
    }
    if (!artistIds || !Array.isArray(artistIds) || artistIds.length === 0) {
      res.status(400).json({ error: 'artistIds must be a non-empty array' });
      return;
    }

    const token = (req as AuthenticatedRequest).spotifyToken;
    const telegramUserId = (req as AuthenticatedRequest).telegramUserId;

    const playlist = await spotifyService.createPlaylist(token, userId, name, description || '');

    // Save playlist settings to database
    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (user) {
      const nextUpdateAt = schedule ? calculateNextUpdate(schedule) : null;
      await prisma.playlist.upsert({
        where: { userId_spotifyPlaylistId: { userId: user.id, spotifyPlaylistId: playlist.id } },
        create: {
          userId: user.id,
          spotifyPlaylistId: playlist.id,
          name,
          artistIds,
          trackCount: trackCount || 100,
          weights: weights || null,
          eraPreference: eraPreference ?? 50,
          eraPreferences: eraPreferences || null,
          schedule: schedule || null,
          nextUpdateAt,
        },
        update: {
          name,
          artistIds,
          trackCount: trackCount || 100,
          weights: weights || null,
          eraPreference: eraPreference ?? 50,
          eraPreferences: eraPreferences || null,
          schedule: schedule || null,
          nextUpdateAt,
        },
      });
    }

    log.info('Playlist created', { playlistId: playlist.id, name, artistCount: artistIds.length });
    getTap().notify({
      type: 'playlist.create',
      userId: telegramUserId,
      message: `Created playlist "${name}"`,
      meta: { playlistId: playlist.id, artistCount: artistIds.length, trackCount: trackCount || 100 },
    });
    res.json(playlist);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to create playlist', { error: message });
    res.status(500).json({ error: message });
  }
});

// POST /api/playlists/:playlistId/tracks — add tracks to a playlist
spotifyRoutes.post('/api/playlists/:playlistId/tracks', async (req: Request, res: Response) => {
  try {
    const { trackUris } = req.body;
    if (!trackUris || !Array.isArray(trackUris) || trackUris.length === 0) {
      res.status(400).json({ error: 'trackUris must be a non-empty array' });
      return;
    }
    if (trackUris.length > 500) {
      res.status(400).json({ error: 'Maximum 500 tracks per request' });
      return;
    }
    await spotifyService.addTracksToPlaylist(
      (req as AuthenticatedRequest).spotifyToken,
      param(req, 'playlistId'),
      trackUris
    );
    log.info('Tracks added to playlist', { playlistId: param(req, 'playlistId'), count: trackUris.length });
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to add tracks', { playlistId: param(req, 'playlistId'), error: message });
    res.status(500).json({ error: message });
  }
});

// POST /api/playlists/:playlistId/update — refresh a playlist with randomized tracks
spotifyRoutes.post('/api/playlists/:playlistId/update', async (req: Request, res: Response) => {
  try {
    const token = (req as AuthenticatedRequest).spotifyToken;
    const telegramUserId = (req as AuthenticatedRequest).telegramUserId;
    const spotifyPlaylistId = param(req, 'playlistId');

    // Read playlist settings from database
    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const dbPlaylist = await prisma.playlist.findFirst({
      where: { userId: user.id, spotifyPlaylistId },
    });
    if (!dbPlaylist || dbPlaylist.artistIds.length === 0) {
      res.status(400).json({ error: 'Playlist not found in database or has no configured artists' });
      return;
    }

    const { artistIds, trackCount, weights: weightsJson } = dbPlaylist;
    const weights = weightsJson
      ? new Map<string, number>(Object.entries(weightsJson as Record<string, number>))
      : undefined;

    log.info('Updating playlist', { spotifyPlaylistId, artistCount: artistIds.length, trackCount });

    // Gather tracks from all artists (processed through the rate-limited queue)
    const artistsTracks = new Map<string, any[]>();
    for (const id of artistIds) {
      try {
        const tracks = await spotifyService.getAllArtistTracks(token, id);
        artistsTracks.set(id, tracks);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        log.warn(`Failed to fetch tracks for artist ${id}`, { artistId: id, error: msg });
      }
    }

    const selected = selectRandomTracks(artistsTracks, trackCount, weights);
    const uris = selected.map((t: any) => t.uri);

    await spotifyService.replacePlaylistTracks(token, spotifyPlaylistId, uris);

    // Update lastUpdatedAt (and recalculate nextUpdateAt if scheduled)
    const updateFields: any = { lastUpdatedAt: new Date() };
    if (dbPlaylist.schedule) {
      updateFields.nextUpdateAt = calculateNextUpdate(dbPlaylist.schedule);
    }
    await prisma.playlist.update({
      where: { id: dbPlaylist.id },
      data: updateFields,
    });

    log.info('Playlist updated successfully', { spotifyPlaylistId, trackCount: uris.length });
    getTap().notify({
      type: 'playlist.update',
      userId: telegramUserId,
      message: `Manually refreshed "${dbPlaylist.name}"`,
      meta: { spotifyPlaylistId, trackCount: uris.length, artistCount: artistIds.length },
    });
    res.json({ success: true, trackCount: uris.length, artistCount: artistIds.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to update playlist', { playlistId: param(req, 'playlistId'), error: message });
    res.status(500).json({ error: message });
  }
});

// PATCH /api/playlists/:playlistId — rename a playlist on Spotify and in DB
spotifyRoutes.patch('/api/playlists/:playlistId', async (req: Request, res: Response) => {
  try {
    const token = (req as AuthenticatedRequest).spotifyToken;
    const telegramUserId = (req as AuthenticatedRequest).telegramUserId;
    const spotifyPlaylistId = param(req, 'playlistId');
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (name.length > 100) {
      res.status(400).json({ error: 'Playlist name must be 100 characters or less' });
      return;
    }

    await spotifyService.updatePlaylistDetails(token, spotifyPlaylistId, { name: name.trim() });

    // Update in DB if managed
    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (user) {
      const dbPlaylist = await prisma.playlist.findFirst({
        where: { userId: user.id, spotifyPlaylistId },
      });
      if (dbPlaylist) {
        await prisma.playlist.update({
          where: { id: dbPlaylist.id },
          data: { name: name.trim() },
        });
      }
    }

    log.info('Playlist renamed', { spotifyPlaylistId, name: name.trim() });
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to rename playlist', { playlistId: param(req, 'playlistId'), error: message });
    res.status(500).json({ error: message });
  }
});

// DELETE /api/playlists/:playlistId — unfollow a playlist
spotifyRoutes.delete('/api/playlists/:playlistId', async (req: Request, res: Response) => {
  try {
    await spotifyService.unfollowPlaylist((req as AuthenticatedRequest).spotifyToken, param(req, 'playlistId'));
    log.info('Playlist unfollowed', { playlistId: param(req, 'playlistId') });
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to unfollow playlist', { playlistId: param(req, 'playlistId'), error: message });
    res.status(500).json({ error: message });
  }
});

// GET /api/playlists/:playlistId/settings — get playlist settings from DB
spotifyRoutes.get('/api/playlists/:playlistId/settings', async (req: Request, res: Response) => {
  try {
    const telegramUserId = (req as AuthenticatedRequest).telegramUserId;
    const spotifyPlaylistId = param(req, 'playlistId');

    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const dbPlaylist = await prisma.playlist.findFirst({
      where: { userId: user.id, spotifyPlaylistId },
    });
    if (!dbPlaylist) {
      res.json({ managed: false });
      return;
    }

    res.json({
      managed: true,
      artistIds: dbPlaylist.artistIds,
      trackCount: dbPlaylist.trackCount,
      weights: dbPlaylist.weights,
      eraPreference: dbPlaylist.eraPreference,
      eraPreferences: dbPlaylist.eraPreferences,
      schedule: dbPlaylist.schedule,
      status: dbPlaylist.status,
      lastUpdatedAt: dbPlaylist.lastUpdatedAt,
      nextUpdateAt: dbPlaylist.nextUpdateAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to fetch playlist settings', { playlistId: param(req, 'playlistId'), error: message });
    res.status(500).json({ error: message });
  }
});

// PATCH /api/playlists/:playlistId/settings — update playlist settings in DB
spotifyRoutes.patch('/api/playlists/:playlistId/settings', async (req: Request, res: Response) => {
  try {
    const telegramUserId = (req as AuthenticatedRequest).telegramUserId;
    const spotifyPlaylistId = param(req, 'playlistId');
    const { artistIds, trackCount, weights, eraPreference, eraPreferences, schedule } = req.body;

    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const dbPlaylist = await prisma.playlist.findFirst({
      where: { userId: user.id, spotifyPlaylistId },
    });
    if (!dbPlaylist) {
      res.status(404).json({ error: 'Playlist not managed by Brewtify' });
      return;
    }

    const updateData: any = {};
    if (artistIds !== undefined) {
      if (!Array.isArray(artistIds) || artistIds.length === 0) {
        res.status(400).json({ error: 'artistIds must be a non-empty array' });
        return;
      }
      updateData.artistIds = artistIds;
    }
    if (trackCount !== undefined) updateData.trackCount = Math.min(Math.max(trackCount, 20), 200);
    if (weights !== undefined) updateData.weights = weights;
    if (eraPreference !== undefined) updateData.eraPreference = Math.min(Math.max(eraPreference, 0), 100);
    if (eraPreferences !== undefined) updateData.eraPreferences = eraPreferences;
    if (schedule !== undefined) {
      updateData.schedule = schedule;
      if (schedule) {
        updateData.nextUpdateAt = calculateNextUpdate(schedule);
        updateData.status = 'active';
        updateData.failureCount = 0;
        updateData.lastError = null;
      } else {
        updateData.nextUpdateAt = null;
      }
    }

    await prisma.playlist.update({
      where: { id: dbPlaylist.id },
      data: updateData,
    });

    log.info('Playlist settings updated', { spotifyPlaylistId });
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to update playlist settings', { playlistId: param(req, 'playlistId'), error: message });
    res.status(500).json({ error: message });
  }
});
