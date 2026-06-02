import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { spotifyService } from '../services/spotify';
import { tokenStore } from '../services/token-store-db';
import { pendingAuthStore } from '../services/pending-auth-store';
import { createLogger } from '../utils/logger';
import { getTap } from '@brewtify/tap';

const log = createLogger('auth');

export const authRoutes = Router();

// Mini-app login — redirects to Spotify OAuth directly
authRoutes.get('/login', async (req: Request, res: Response) => {
  const telegramUserId = req.query.telegramUserId as string;

  if (!telegramUserId) {
    res.status(400).send('Missing telegramUserId parameter');
    return;
  }

  const state = crypto.randomUUID();
  await pendingAuthStore.set(state, telegramUserId);
  const authUrl = spotifyService.getAuthUrl(state);
  log.info('Login initiated', { telegramUserId });
  res.redirect(authUrl);
});

// Spotify OAuth callback — exchanges code for tokens and stores them for the Telegram user
authRoutes.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    log.warn('OAuth callback received error', { error: String(error) });
    res.status(400).send(`Authorization failed: ${error}`);
    return;
  }

  if (!code || !state) {
    res.status(400).send('Missing code or state parameter');
    return;
  }

  const telegramUserId = String(await pendingAuthStore.get(state as string) || '');
  if (!telegramUserId) {
    res.status(400).send('Invalid or expired authorization state. Please run /login again.');
    return;
  }

  try {
    const tokens = await spotifyService.exchangeCode(code as string);

    await tokenStore.set(telegramUserId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000),
    });

    await pendingAuthStore.delete(state as string);
    log.info('OAuth completed successfully', { telegramUserId });
    getTap().notify({
      type: 'user.login',
      userId: telegramUserId,
      message: 'User connected Spotify account',
    });

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brewtify — Connected</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #121212;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .icon {
      width: 64px;
      height: 64px;
      background: #1DB954;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      font-size: 32px;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    p {
      color: #B3B3B3;
      font-size: 0.95rem;
      max-width: 280px;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✓</div>
    <h1>You're connected!</h1>
    <p>You can close this window and return to Telegram.</p>
  </div>
</body>
</html>`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('OAuth callback failed', { telegramUserId, error: message });
    res.status(500).send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brewtify — Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #121212;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .icon {
      width: 64px;
      height: 64px;
      background: #e74c3c;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      font-size: 32px;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    p {
      color: #B3B3B3;
      font-size: 0.95rem;
      max-width: 280px;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✕</div>
    <h1>Connection failed</h1>
    <p>Please try /login again in Telegram.</p>
  </div>
</body>
</html>`);
  }
});

// Per-user refresh lock to prevent concurrent token refreshes
const refreshLocks = new Map<string, Promise<string | null>>();

// Helper: get a valid access token for a Telegram user, refreshing if needed
export async function getAccessTokenForUser(telegramUserId: string): Promise<string | null> {
  const stored = await tokenStore.get(telegramUserId);
  if (!stored) return null;

  const isExpired = Date.now() >= (stored.expiresAt - 60000);

  if (!isExpired) {
    return stored.accessToken;
  }

  // Check if a refresh is already in progress for this user
  const existing = refreshLocks.get(telegramUserId);
  if (existing) {
    log.debug('Waiting for in-progress token refresh', { telegramUserId });
    return existing;
  }

  // Start a new refresh and store the promise so concurrent requests await it
  const refreshPromise = (async (): Promise<string | null> => {
    try {
      log.info('Refreshing expired token', { telegramUserId });
      const tokens = await spotifyService.refreshAccessToken(stored.refreshToken);
      await tokenStore.set(telegramUserId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || stored.refreshToken,
        expiresAt: Date.now() + (tokens.expires_in * 1000),
      });
      return tokens.access_token;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Token refresh failed, clearing stored tokens', { telegramUserId, error: message });
      await tokenStore.delete(telegramUserId);
      return null;
    } finally {
      refreshLocks.delete(telegramUserId);
    }
  })();

  refreshLocks.set(telegramUserId, refreshPromise);
  return refreshPromise;
}

// POST /logout — remove stored tokens for the user
authRoutes.post('/logout', async (req: Request, res: Response) => {
  const telegramUserId = req.headers['x-telegram-user-id'] as string | undefined;

  if (!telegramUserId) {
    res.status(401).json({ error: 'Missing X-Telegram-User-Id header' });
    return;
  }

  await tokenStore.delete(telegramUserId);
  log.info('User logged out', { telegramUserId });
  res.json({ success: true });
});
