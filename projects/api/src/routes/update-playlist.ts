import { FastifyInstance } from 'fastify';
import { ensureAuthenticated } from './auth';
import { spotifyService } from '../services/spotify';
import { parseArtistIdsFromDescription } from '../../../shared/src/playlist-updater';

export default async function updatePlaylistRoutes(server: FastifyInstance) {
  // Update playlist with new random tracks
  server.post('/api/playlists/:playlistId/update', async (request, reply) => {
    const accessToken = await ensureAuthenticated(request, reply);

    const { playlistId } = request.params as { playlistId: string };

    try {
      // Fetch playlist details
      const playlist = await spotifyService.getPlaylist(accessToken, playlistId);

      // Parse artist IDs from description
      const artistIds = parseArtistIdsFromDescription(playlist.description);

      if (artistIds.length === 0) {
        return reply.status(400).send({
          error: 'No artist IDs found in playlist description',
        });
      }

      const trackCount = playlist.tracks.total;

      // Fetch tracks from all artists
      const allTracks: any[] = [];
      for (const artistId of artistIds) {
        const tracks = await spotifyService.getAllArtistTracks(accessToken, artistId);
        allTracks.push(...tracks);
      }

      // Shuffle and select tracks
      const shuffled = allTracks.sort(() => Math.random() - 0.5);
      const selectedTracks = shuffled.slice(0, trackCount);
      const trackUris = selectedTracks.map((track) => track.uri);

      // Replace playlist tracks
      await spotifyService.replacePlaylistTracks(accessToken, playlistId, trackUris);

      reply.send({
        success: true,
        trackCount: selectedTracks.length,
        artistCount: artistIds.length,
      });
    } catch (error: any) {
      server.log.error(error);
      reply.status(500).send({ error: 'Failed to update playlist' });
    }
  });
}
