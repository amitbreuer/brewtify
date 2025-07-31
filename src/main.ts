import dotenv from 'dotenv';
import { env } from './utils/env';
import server from './server';

dotenv.config({ path: ['.env.local', '.env'] });

(async function main() {
  try {
    await server.ready();
    await server.listen({ port: env('PORT', 3000) });
    } catch (err) {
    console.error('❌ Server failed to start:', err);
    process.exit(1);
  }
})();
