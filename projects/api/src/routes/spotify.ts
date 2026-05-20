import { Router, Request, Response, NextFunction } from 'express';
import { spotifyService } from '../services/spotify';
import { getAccessTokenForUser } from './auth';
import { parseArtistIdsFromDescription, parseWeightsFromDescription, selectRandomTracks } from '@brewtify/shared';

export const spotifyRoutes = Router();

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

  (req as any).spotifyToken = accessToken;
  next();
}

spotifyRoutes.use('/api', requireAuth);

// GET /api/profile
spotifyRoutes.get('/api/profile', async (req: Request, res: Response) => {
  try {
    const profile = await spotifyService.getProfile((req as any).spotifyToken);
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/playlists
spotifyRoutes.get('/api/playlists', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const data = await spotifyService.getPlaylists((req as any).spotifyToken, limit);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/playlists/:playlistId
spotifyRoutes.get('/api/playlists/:playlistId', async (req: Request, res: Response) => {
  try {
    const playlist = await spotifyService.getPlaylist(
      (req as any).spotifyToken,
      req.params.playlistId as string
    );
    res.json(playlist);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    const artists = await spotifyService.getArtists((req as any).spotifyToken, ids);
    res.json(artists);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/artists/followed
spotifyRoutes.get('/api/artists/followed', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const after = req.query.after as string | undefined;
    const data = await spotifyService.getFollowedArtists((req as any).spotifyToken, limit, after);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/artists/:artistId/tracks
spotifyRoutes.get('/api/artists/:artistId/tracks', async (req: Request, res: Response) => {
  try {
    const tracks = await spotifyService.getAllArtistTracks(
      (req as any).spotifyToken,
      req.params.artistId as string
    );
    res.json(tracks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    const playlist = await spotifyService.createPlaylist(
      (req as any).spotifyToken,
      userId,
      name,
      description || ''
    );
    res.json(playlist);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/playlists/:playlistId/tracks — add tracks to a playlist
spotifyRoutes.post('/api/playlists/:playlistId/tracks', async (req: Request, res: Response) => {
  try {
    const { trackUris } = req.body;
    if (!trackUris || !Array.isArray(trackUris)) {
      res.status(400).json({ error: 'trackUris array is required' });
      return;
    }
    await spotifyService.addTracksToPlaylist(
      (req as any).spotifyToken,
      req.params.playlistId as string,
      trackUris
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/playlists/:playlistId/update — refresh a playlist with auto-update
spotifyRoutes.post('/api/playlists/:playlistId/update', async (req: Request, res: Response) => {
  try {
    const token = (req as any).spotifyToken;
    const playlistId = req.params.playlistId as string;
    const playlist = await spotifyService.getPlaylist(token, playlistId);

    const artistIds = parseArtistIdsFromDescription(playlist.description || '');
    if (artistIds.length === 0) {
      res.status(400).json({ error: 'No auto-update artist IDs found in playlist description' });
      return;
    }

    const weights = parseWeightsFromDescription(playlist.description || '');
    const targetCount = playlist.tracks?.total || 60;

    // Gather tracks from all artists
    const results = await Promise.allSettled(
      artistIds.map((id) => spotifyService.getAllArtistTracks(token, id))
    );

    const artistsTracks = new Map<string, any[]>();
    artistIds.forEach((id, index) => {
      const result = results[index];
      if (result.status === 'fulfilled') {
        artistsTracks.set(id, result.value);
      }
    });

    const selected = selectRandomTracks(artistsTracks, targetCount, weights);
    const uris = selected.map((t) => t.uri);

    await spotifyService.replacePlaylistTracks(token, playlistId, uris);

    res.json({ success: true, trackCount: uris.length, artistCount: artistIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/playlists/:playlistId — unfollow a playlist
spotifyRoutes.delete('/api/playlists/:playlistId', async (req: Request, res: Response) => {
  try {
    await spotifyService.unfollowPlaylist((req as any).spotifyToken, req.params.playlistId as string);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/playlists/:playlistId/description
spotifyRoutes.patch('/api/playlists/:playlistId/description', async (req: Request, res: Response) => {
  try {
    const { description } = req.body;
    await spotifyService.updatePlaylistDetails(
      (req as any).spotifyToken,
      req.params.playlistId as string,
      { description }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
