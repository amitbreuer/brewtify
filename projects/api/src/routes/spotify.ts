import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spotifyService } from '../services/spotify';
import { ensureAuthenticated } from './auth';

export default async function spotifyRoutes(server: FastifyInstance) {
  // Get user profile
  server.get('/api/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const accessToken = await ensureAuthenticated(request, reply);
    const profile = await spotifyService.getProfile(accessToken);
    return profile;
  });

  // Get user playlists
  server.get('/api/playlists', async (request: FastifyRequest<{ Querystring: { limit?: number } }>, reply: FastifyReply) => {
    const accessToken = await ensureAuthenticated(request, reply);
    const { limit = 50 } = request.query;
    const playlists = await spotifyService.getPlaylists(accessToken, limit);
    return playlists;
  });

  // Get followed artists
  server.get('/api/artists/followed', async (
    request: FastifyRequest<{ Querystring: { limit?: number; after?: string } }>,
    reply: FastifyReply
  ) => {
    const accessToken = await ensureAuthenticated(request, reply);
    const { limit = 50, after } = request.query;
    const artists = await spotifyService.getFollowedArtists(accessToken, limit, after);
    return artists;
  });

  // Get all tracks for an artist
  server.get('/api/artists/:artistId/tracks', async (
    request: FastifyRequest<{ Params: { artistId: string } }>,
    reply: FastifyReply
  ) => {
    const accessToken = await ensureAuthenticated(request, reply);
    const { artistId } = request.params;
    const tracks = await spotifyService.getAllArtistTracks(accessToken, artistId);
    return tracks;
  });

  // Create playlist
  server.post('/api/playlists', async (
    request: FastifyRequest<{
      Body: {
        userId: string;
        name: string;
        description: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const accessToken = await ensureAuthenticated(request, reply);
    const { userId, name, description } = request.body;
    const playlist = await spotifyService.createPlaylist(accessToken, userId, name, description);
    return playlist;
  });

  // Add tracks to playlist
  server.post('/api/playlists/:playlistId/tracks', async (
    request: FastifyRequest<{
      Params: { playlistId: string };
      Body: { trackUris: string[] }
    }>,
    reply: FastifyReply
  ) => {
    const accessToken = await ensureAuthenticated(request, reply);
    const { playlistId } = request.params;
    const { trackUris } = request.body;
    await spotifyService.addTracksToPlaylist(accessToken, playlistId, trackUris);
    return { success: true };
  });
}
