import dotenv from 'dotenv';
import { env } from './utils/env';
import { createServer } from './server';
import { createBot } from './bot';

dotenv.config({ path: ['.env.local', '.env'] });

(async function main() {
  try {
    const port = env('PORT', 5173);
    const app = createServer();

    app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Server listening on http://0.0.0.0:${port}`);
    });

    const bot = createBot();
    await bot.start();
    console.log('🤖 Telegram bot started (long polling)');
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
})();
