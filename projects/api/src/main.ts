import dotenv from 'dotenv';
import { env } from './utils/env';
import { createServer } from './server';

dotenv.config({ path: ['.env.local', '.env'] });

(async function main() {
  try {
    const server = await createServer();
    await server.listen({ port: env('PORT', 3000), host: '0.0.0.0' });
    server.log.info('Available routes:');
    const routes = server.printRoutes();
    server.log.info(`Routes: ${routes}`);
    const plugins = server.printPlugins();
    server.log.info(`Plugins: ${plugins}`);
    } catch (err) {
    console.error('❌ Server failed to start:', err);
    process.exit(1);
  }
})();
