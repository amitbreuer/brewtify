import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

import { env } from './utils/env';
import { createServer } from './server';
import { createBot, setupBotWebhook } from './bot';
import { prisma } from './services/db';
import { createLogger } from './utils/logger';

const log = createLogger('main');

(async function main() {
  try {
    // Verify database connection
    await prisma.$connect();
    log.info('Database connected');

    const port = env('PORT', 5173);
    const app = createServer();

    // Set up Telegram bot webhook (replaces long-polling for scale-to-zero)
    try {
      const bot = createBot();
      setupBotWebhook(app, bot);
      log.info('Telegram bot webhook registered');
    } catch (botErr) {
      log.warn('Telegram bot setup failed', { error: (botErr as Error).message });
    }

    app.listen(port, '0.0.0.0', () => {
      log.info(`Server listening on http://0.0.0.0:${port}`);
    });
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
