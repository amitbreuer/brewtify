import { fastify } from 'fastify';
import { fastifySwagger } from '@fastify/swagger';
import { fastifySwaggerUi } from '@fastify/swagger-ui';
import { fastifyCors } from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import spotifyRoutes from './routes/spotify';
import updatePlaylistRoutes from './routes/update-playlist';

export async function createServer() {
  const server = fastify({ logger: true });

  await server.register(fastifyCors, {
    origin: ['http://127.0.0.1:5173'],
    credentials: true,
  });

  // Register cookie support (required for sessions)
  await server.register(fastifyCookie);

  // Register session support
  await server.register(fastifySession, {
    secret: process.env.SESSION_SECRET || 'a-very-secure-secret-key-change-in-production',
    cookie: {
      secure: false, // Set to true in production with HTTPS
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax',
      // No domain set - will default to the host (127.0.0.1)
    },
  });

  await server.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Brewtify API',
        description: 'Spotify Playlist Brewery API',
        version: '1.0.0'
      }
    }
  });

  await server.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
  });

  await server.register(healthRoutes);
  await server.register(authRoutes);
  await server.register(spotifyRoutes);
  await server.register(updatePlaylistRoutes);

  return server;
}
