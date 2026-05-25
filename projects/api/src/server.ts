import express from 'express';
import path from 'path';
import cors from 'cors';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { spotifyRoutes } from './routes/spotify';

export function createServer() {
  const app = express();

  app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Telegram-User-Id'],
    exposedHeaders: ['Content-Type'],
  }));

  app.use(express.json());

  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(spotifyRoutes);

  // Serve Telegram Mini App static files
  const miniAppPath = path.join(__dirname, '../../mini-app/dist');
  app.use('/app', express.static(miniAppPath));
  app.get('/app/{*splat}', (_req, res) => {
    res.sendFile(path.join(miniAppPath, 'index.html'));
  });

  return app;
}
