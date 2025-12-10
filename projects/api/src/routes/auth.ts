import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spotifyService } from '../services/spotify';

declare module 'fastify' {
  interface Session {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    codeVerifier?: string;
  }
}

export default async function authRoutes(server: FastifyInstance) {
  // Store tokens in session (called by frontend after OAuth)
  server.post('/auth/session', async (
    request: FastifyRequest<{ Body: { accessToken: string; refreshToken: string; expiresIn: number } }>,
    reply: FastifyReply
  ) => {
    const { accessToken, refreshToken, expiresIn } = request.body;

    if (!accessToken || !refreshToken || !expiresIn) {
      return reply.code(400).send({ error: 'Missing required token data' });
    }

    // Store tokens in session
    request.session.accessToken = accessToken;
    request.session.refreshToken = refreshToken;
    request.session.expiresAt = Date.now() + (expiresIn * 1000);

    return { success: true };
  });

  // Get auth status
  server.get('/auth/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { accessToken, expiresAt } = request.session;

    if (!accessToken || !expiresAt) {
      return { authenticated: false };
    }

    // Check if token is expired (with 60 second buffer)
    const isExpired = Date.now() >= (expiresAt - 60000);

    if (isExpired && request.session.refreshToken) {
      try {
        // Refresh the token
        const tokens = await spotifyService.refreshAccessToken(request.session.refreshToken);
        request.session.accessToken = tokens.access_token;
        request.session.expiresAt = Date.now() + (tokens.expires_in * 1000);
        if (tokens.refresh_token) {
          request.session.refreshToken = tokens.refresh_token;
        }
        return { authenticated: true };
      } catch (error: any) {
        server.log.error('Token refresh error:', error);
        return { authenticated: false };
      }
    }

    return { authenticated: !isExpired };
  });

  // Logout
  server.post('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.session.destroy();
    return { success: true };
  });
}

// Helper function to ensure authenticated
export async function ensureAuthenticated(request: FastifyRequest, reply: FastifyReply): Promise<string> {
  const { accessToken, expiresAt, refreshToken } = request.session;

  if (!accessToken || !expiresAt) {
    reply.code(401).send({ error: 'Not authenticated' });
    throw new Error('Not authenticated');
  }

  // Check if token is expired (with 60 second buffer)
  const isExpired = Date.now() >= (expiresAt - 60000);

  if (isExpired && refreshToken) {
    try {
      // Refresh the token
      const tokens = await spotifyService.refreshAccessToken(refreshToken);
      request.session.accessToken = tokens.access_token;
      request.session.expiresAt = Date.now() + (tokens.expires_in * 1000);
      if (tokens.refresh_token) {
        request.session.refreshToken = tokens.refresh_token;
      }
      return tokens.access_token;
    } catch (error: any) {
      reply.code(401).send({ error: 'Token refresh failed' });
      throw new Error('Token refresh failed');
    }
  }

  if (isExpired) {
    reply.code(401).send({ error: 'Token expired' });
    throw new Error('Token expired');
  }

  return accessToken;
}
