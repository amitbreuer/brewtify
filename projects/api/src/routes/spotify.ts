import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { spotifyService } from "../services/spotify";
import { ensureAuthenticated } from "./auth";

export default async function spotifyRoutes(server: FastifyInstance) {
  // Get user profile
  server.get(
    "/api/profile",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accessToken = await ensureAuthenticated(request, reply);
      return await spotifyService.getProfile(accessToken);
    },
  );

  // Get user playlists
  server.get(
    "/api/playlists",
    async (
      request: FastifyRequest<{ Querystring: { limit?: number } }>,
      reply: FastifyReply,
    ) => {
      const accessToken = await ensureAuthenticated(request, reply);
      const { limit = 50 } = request.query;
      return await spotifyService.getPlaylists(accessToken, limit);
    },
  );

  // Get followed artists
  server.get(
    "/api/artists/followed",
    async (
      request: FastifyRequest<{
        Querystring: { limit?: number; after?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const accessToken = await ensureAuthenticated(request, reply);
      const { limit = 50, after } = request.query;
      return await spotifyService.getFollowedArtists(accessToken, limit, after);
    },
  );

  // Get all tracks for an artist
  server.get(
    "/api/artists/:artistId/tracks",
    async (
      request: FastifyRequest<{ Params: { artistId: string } }>,
      reply: FastifyReply,
    ) => {
      const accessToken = await ensureAuthenticated(request, reply);
      const { artistId } = request.params;
      return await spotifyService.getAllArtistTracks(accessToken, artistId);
    },
  );

  // Create playlist
  server.post(
    "/api/playlists",
    async (
      request: FastifyRequest<{
        Body: {
          userId: string;
          name: string;
          description: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const accessToken = await ensureAuthenticated(request, reply);
      const { userId, name, description } = request.body;
      return await spotifyService.createPlaylist(
        accessToken,
        userId,
        name,
        description,
      );
    },
  );

  // Add tracks to playlist
  server.post(
    "/api/playlists/:playlistId/tracks",
    async (
      request: FastifyRequest<{
        Params: { playlistId: string };
        Body: { trackUris: string[] };
      }>,
      reply: FastifyReply,
    ) => {
      const accessToken = await ensureAuthenticated(request, reply);
      const { playlistId } = request.params;
      const { trackUris } = request.body;
      console.log(`[Add Tracks] Playlist: ${playlistId}, Track count: ${trackUris?.length || 0}`);
      console.log(`[Add Tracks] Track URIs:`, trackUris);
      await spotifyService.addTracksToPlaylist(
        accessToken,
        playlistId,
        trackUris,
      );
      console.log(`[Add Tracks] Successfully added tracks`);
      return { success: true };
    },
  );
}
