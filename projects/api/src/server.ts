import express from 'express';
import path from 'path';
import cors from 'cors';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { spotifyRoutes } from './routes/spotify';
import { cronRoutes } from './routes/cron';
import { requestLogger } from './middleware/request-logger';
import { env } from './utils/env';

const ALLOWED_ORIGINS = [
  'https://brewtify-133698158612.me-west1.run.app',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

export function createServer() {
  const app = express();

  // Additional origins from env (comma-separated)
  const extraOrigins = env('CORS_ORIGINS', '').split(',').filter(Boolean);
  const origins = [...ALLOWED_ORIGINS, ...extraOrigins];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, same-origin)
      if (!origin || origins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Telegram-User-Id'],
    exposedHeaders: ['Content-Type'],
  }));

  app.use(express.json());
  app.use(requestLogger);

  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(spotifyRoutes);
  app.use(cronRoutes);

  // Serve Telegram Mini App static files
  const miniAppPath = path.join(__dirname, '../../mini-app/dist');
  app.use('/app', express.static(miniAppPath, {
    etag: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  app.get('/app/{*splat}', (req, res) => {
    // Only serve index.html for non-asset routes (SPA fallback)
    if (req.path.match(/\.\w+$/)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(miniAppPath, 'index.html'));
  });

  return app;
}
