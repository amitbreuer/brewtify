import { fastify } from 'fastify';
import { fastifySwagger } from '@fastify/swagger';
import { fastifySwaggerUi } from '@fastify/swagger-ui';
import { fastifyCors } from '@fastify/cors';
import healthRoutes from './routes/health';

export async function createServer() {
  const server = fastify({ logger: true });

  await server.register(fastifyCors, {
    origin: ['http://127.0.0.1:5173'],
    credentials: true,
  });

  await server.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Fastify API',
        description: 'API documentation',
        version: '1.0.0'
      }
    }
  });

  await server.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
  });

  await server.register(healthRoutes);

  return server;
}
