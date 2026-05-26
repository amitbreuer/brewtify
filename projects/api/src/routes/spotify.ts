import { Router, Request, Response, NextFunction } from 'express';
import { spotifyService } from '../services/spotify';
import { getAccessTokenForUser } from './auth';
import { parseArtistIdsFromDescription, parseWeightsFromDescription, selectRandomTracks } from '@brewtify/shared';
import { createLogger } from '../utils/logger';

const log = createLogger('spotify-routes');

export const spotifyRoutes = Router();

// Extend Request to carry the Spotify token
interface AuthenticatedRequest extends Request {
  spotifyToken: string;
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

  (req as AuthenticatedRequest).spotifyToken = accessToken;
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
    res.status(500).json({ error: message });
  }
});

// GET /api/playlists
spotifyRoutes.get('/api/playlists', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 50);
    const data = await spotifyService.getPlaylists((req as AuthenticatedRequest).spotifyToken, limit);
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

// POST /api/playlists — create a new playlist
spotifyRoutes.post('/api/playlists', async (req: Request, res: Response) => {
  try {
    const { userId, name, description } = req.body;
    if (!userId || !name) {
      res.status(400).json({ error: 'userId and name are required' });
      return;
    }
    if (name.length > 100) {
      res.status(400).json({ error: 'Playlist name must be 100 characters or less' });
      return;
    }
    const playlist = await spotifyService.createPlaylist(
      (req as AuthenticatedRequest).spotifyToken,
      userId,
      name,
      description || ''
    );
    log.info('Playlist created', { playlistId: playlist.id, name });
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

// POST /api/playlists/:playlistId/update — refresh a playlist with auto-update
spotifyRoutes.post('/api/playlists/:playlistId/update', async (req: Request, res: Response) => {
  try {
    const token = (req as AuthenticatedRequest).spotifyToken;
    const playlistId = param(req, 'playlistId');
    const playlist = await spotifyService.getPlaylist(token, playlistId);

    const artistIds = parseArtistIdsFromDescription(playlist.description || '');
    if (artistIds.length === 0) {
      res.status(400).json({ error: 'No auto-update artist IDs found in playlist description' });
      return;
    }

    const weights = parseWeightsFromDescription(playlist.description || '');
    const targetCount = playlist.tracks?.total || 60;

    log.info('Updating playlist', { playlistId, artistCount: artistIds.length, targetCount });

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

    const selected = selectRandomTracks(artistsTracks, targetCount, weights);
    const uris = selected.map((t: any) => t.uri);

    await spotifyService.replacePlaylistTracks(token, playlistId, uris);

    log.info('Playlist updated successfully', { playlistId, trackCount: uris.length });
    res.json({ success: true, trackCount: uris.length, artistCount: artistIds.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to update playlist', { playlistId: param(req, 'playlistId'), error: message });
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

// PATCH /api/playlists/:playlistId/description
spotifyRoutes.patch('/api/playlists/:playlistId/description', async (req: Request, res: Response) => {
  try {
    const { description } = req.body;
    if (typeof description !== 'string') {
      res.status(400).json({ error: 'description must be a string' });
      return;
    }
    await spotifyService.updatePlaylistDetails(
      (req as AuthenticatedRequest).spotifyToken,
      param(req, 'playlistId'),
      { description }
    );
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Failed to update playlist description', { playlistId: param(req, 'playlistId'), error: message });
    res.status(500).json({ error: message });
  }
});
