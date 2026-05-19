import express from 'express';
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

  return app;
}
