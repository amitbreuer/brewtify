import { Router, Request, Response } from 'express';
import { env } from '../utils/env';
import { processScheduledUpdates } from '../services/scheduler';
import { createLogger } from '../utils/logger';

const log = createLogger('cron');

export const cronRoutes = Router();

/**
 * POST /cron/update
 * Triggered by Cloud Scheduler to run playlist updates.
 * Protected by X-Cron-Secret header.
 */
cronRoutes.post('/cron/update', async (req: Request, res: Response) => {
  const secret = req.headers['x-cron-secret'];
  const expected = env('CRON_SECRET', '');

  if (!expected || secret !== expected) {
    log.warn('Unauthorized cron request');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  log.info('Cron update triggered');

  try {
    await processScheduledUpdates();
    res.json({ ok: true });
  } catch (err) {
    log.error('Cron update failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Update failed' });
  }
});
