import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { spotifyService } from '../services/spotify';
import { tokenStore } from '../services/token-store-db';
import { pendingAuthStore } from '../services/pending-auth-store';
import { createLogger } from '../utils/logger';

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

    res.send('<h1>✅ Logged in!</h1><p>You can close this window and return to Telegram.</p>');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('OAuth callback failed', { telegramUserId, error: message });
    res.status(500).send('Failed to complete authorization. Please try /login again.');
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
