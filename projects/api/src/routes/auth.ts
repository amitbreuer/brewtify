import { Router, Request, Response } from 'express';
import { spotifyService } from '../services/spotify';
import { tokenStore } from '../services/token-store-db';
import { pendingAuthStore } from '../services/pending-auth-store';

export const authRoutes = Router();

// Spotify OAuth callback — exchanges code for tokens and stores them for the Telegram user
authRoutes.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    res.status(400).send(`Authorization failed: ${error}`);
    return;
  }

  if (!code || !state) {
    res.status(400).send('Missing code or state parameter');
    return;
  }

  const telegramUserId = await pendingAuthStore.get(state as string);
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

    res.send('<h1>✅ Logged in!</h1><p>You can close this window and return to Telegram.</p>');
  } catch (err: any) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Failed to complete authorization. Please try /login again.');
  }
});

// Helper: get a valid access token for a Telegram user, refreshing if needed
export async function getAccessTokenForUser(telegramUserId: string): Promise<string | null> {
  const stored = await tokenStore.get(telegramUserId);
  if (!stored) return null;

  const isExpired = Date.now() >= (stored.expiresAt - 60000);

  if (isExpired) {
    try {
      const tokens = await spotifyService.refreshAccessToken(stored.refreshToken);
      await tokenStore.set(telegramUserId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || stored.refreshToken,
        expiresAt: Date.now() + (tokens.expires_in * 1000),
      });
      return tokens.access_token;
    } catch {
      await tokenStore.delete(telegramUserId);
      return null;
    }
  }

  return stored.accessToken;
}
