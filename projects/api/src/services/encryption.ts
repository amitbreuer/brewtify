import crypto from 'crypto';
import { env } from '../utils/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * AES-256-GCM encryption service for securing user tokens.
 *
 * Each user has a unique salt. The master key (from env) is derived per-user
 * using HKDF with their salt, ensuring identical plaintext produces different
 * ciphertext across users.
 *
 * Stored format: base64(iv + authTag + ciphertext)
 */

function getMasterKey(): Buffer {
  const hex = env('ENCRYPTION_KEY');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`);
  }
  return key;
}

function deriveUserKey(salt: string): Buffer {
  const masterKey = getMasterKey();
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, Buffer.from(salt, 'hex'), 'brewtify-tokens', KEY_LENGTH));
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function encrypt(plaintext: string, salt: string): string {
  const key = deriveUserKey(salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (12) + authTag (16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

export function decrypt(encoded: string, salt: string): string {
  const key = deriveUserKey(salt);
  const packed = Buffer.from(encoded, 'base64');

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Generate a new ENCRYPTION_KEY for .env (run once during setup)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}
