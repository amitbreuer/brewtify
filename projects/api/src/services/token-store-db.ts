import { prisma } from './db';
import { encrypt, decrypt, generateSalt } from './encryption';
import { createLogger } from '../utils/logger';

const log = createLogger('token-store');

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Database-backed token store with AES-256-GCM encryption.
 * Replaces the old file-based TokenStore.
 */
export class TokenStore {
  async get(telegramUserId: string): Promise<StoredTokens | null> {
    const user = await prisma.user.findUnique({
      where: { telegramUserId },
    });

    if (!user || !user.encryptedAccessToken || !user.encryptedRefreshToken) {
      return null;
    }

    try {
      const accessToken = decrypt(user.encryptedAccessToken, user.encryptionSalt);
      const refreshToken = decrypt(user.encryptedRefreshToken, user.encryptionSalt);
      return {
        accessToken,
        refreshToken,
        expiresAt: Number(user.tokenExpiresAt),
      };
    } catch (err) {
      log.error('Failed to decrypt tokens', { telegramUserId, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  async set(telegramUserId: string, tokens: StoredTokens): Promise<void> {
    const existing = await prisma.user.findUnique({
      where: { telegramUserId },
    });

    const salt = existing?.encryptionSalt || generateSalt();
    const encryptedAccessToken = encrypt(tokens.accessToken, salt);
    const encryptedRefreshToken = encrypt(tokens.refreshToken, salt);

    await prisma.user.upsert({
      where: { telegramUserId },
      update: {
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt: BigInt(tokens.expiresAt),
      },
      create: {
        telegramUserId,
        encryptionSalt: salt,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt: BigInt(tokens.expiresAt),
      },
    });
  }

  async delete(telegramUserId: string): Promise<void> {
    await prisma.user.update({
      where: { telegramUserId },
      data: {
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
      },
    }).catch(() => {
      // User might not exist — that's fine
    });
  }

  async setSpotifyUserId(telegramUserId: string, spotifyUserId: string): Promise<void> {
    await prisma.user.update({
      where: { telegramUserId },
      data: { spotifyUserId },
    });
  }
}

export const tokenStore = new TokenStore();
