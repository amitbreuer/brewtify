import dotenv from 'dotenv';
import { env } from './utils/env';
import { createServer } from './server';
import { createBot } from './bot';
import { prisma } from './services/db';
import { startScheduler } from './services/scheduler';

dotenv.config({ path: ['.env.local', '.env'] });

(async function main() {
  try {
    // Verify database connection
    await prisma.$connect();
    console.log('🗄️  Database connected');

    const port = env('PORT', 5173);
    const app = createServer();

    app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Server listening on http://0.0.0.0:${port}`);
    });

    const bot = createBot();
    await bot.start();
    console.log('🤖 Telegram bot started (long polling)');

    // Start scheduled playlist updates (daily at 00:00 UTC)
    startScheduler();
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
