import { fastify } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import healthRoutes from './routes/health';
import { env } from './utils/env';

const server = fastify({ logger: true });

server.register(swagger, {
  swagger: {
    info: {
      title: 'Fastify API',
      description: 'API documentation',
      version: '1.0.0'
    },
    host: `localhost:${env('PORT', 3000)}`,
    schemes: ['http'],
    consumes: ['application/json'],
    produces: ['application/json']
  }
});

server.register(swaggerUI, {
  routePrefix: '/docs',
  staticCSP: true,
  transformStaticCSP: (header) => header
});

server.register(healthRoutes);

export default server;
