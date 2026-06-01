import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

import { env } from './utils/env';
import { createServer } from './server';
import { createBot } from './bot';
import { prisma } from './services/db';
import { startScheduler } from './services/scheduler';
import { createLogger } from './utils/logger';

const log = createLogger('main');

(async function main() {
  try {
    // Verify database connection
    await prisma.$connect();
    log.info('Database connected');

    const port = env('PORT', 5173);
    const app = createServer();

    app.listen(port, '0.0.0.0', () => {
      log.info(`Server listening on http://0.0.0.0:${port}`);
    });

    // Start scheduled playlist updates (daily at 00:00 UTC)
    startScheduler();

    // Bot startup is non-fatal — allows local dev while Fly.io is polling
    // bot.start() never resolves (long polling loop), so we don't await it.
    try {
      const bot = createBot();
      bot.start().catch((botErr) => {
        log.warn('Telegram bot stopped', { error: (botErr as Error).message });
      });
      log.info('Telegram bot started (long polling)');
    } catch (botErr) {
      log.warn('Telegram bot failed to start (another instance may be polling)', { error: (botErr as Error).message });
    }
  } catch (err) {
    log.error('Failed to start', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGTERM', async () => {
  log.info('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
