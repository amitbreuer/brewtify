import express from 'express';
import cors from 'cors';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';

export function createServer() {
  const app = express();

  app.use(cors({
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Type'],
  }));

  app.use(express.json());

  app.use(healthRoutes);
  app.use(authRoutes);

  return app;
}
