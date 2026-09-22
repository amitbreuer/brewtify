import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const log = createLogger('http');

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const party = req.path.startsWith('/api/party') || req.path.startsWith('/internal/party');
    const safePath = party ? '/party/[redacted]' : req.path;
    const meta = {
      method: req.method,
      path: safePath,
      status: res.statusCode,
      duration_ms: duration,
      user: party ? undefined : req.headers['x-telegram-user-id'] as string | undefined,
    };

    if (res.statusCode >= 500) {
      log.error(`${req.method} ${safePath} ${res.statusCode}`, meta);
    } else if (res.statusCode >= 400) {
      log.warn(`${req.method} ${safePath} ${res.statusCode}`, meta);
    } else if (req.path !== '/health') {
      log.info(`${req.method} ${safePath} ${res.statusCode}`, meta);
    }
  });

  next();
}
