import { FastifyInstance } from 'fastify';

export default async function routes(server: FastifyInstance) {
  server.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  })
}