import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { PartyError, partyOrigin, required } from './config';
import { rows } from './store';

export const secret = () => randomBytes(32).toString('base64url');
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function identity(value: string): string {
  return createHmac(
    'sha256',
    Buffer.from(required('PARTY_IDENTITY_KEY'), 'hex')
  )
    .update(value)
    .digest('hex');
}
export function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyTelegram(
  initData: string,
  botToken: string,
  now = Date.now()
): { id: string; authDate: number; launchHash: string } {
  if (!initData || initData.length > 8192)
    throw new PartyError(
      401,
      'telegram_required',
      'Open Party inside Telegram.'
    );
  const params = new URLSearchParams(initData);
  const seen = new Set<string>();
  for (const [key] of params) {
    if (seen.has(key))
      throw new PartyError(
        401,
        'invalid_telegram',
        'Invalid Telegram launch data.'
      );
    seen.add(key);
  }
  const supplied = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(supplied))
    throw new PartyError(
      401,
      'invalid_telegram',
      'Invalid Telegram signature.'
    );
  params.delete('hash');
  const check = [...params]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', key).update(check).digest('hex');
  if (!constantEqual(expected, supplied.toLowerCase()))
    throw new PartyError(
      401,
      'invalid_telegram',
      'Invalid Telegram signature.'
    );
  const date = params.get('auth_date') ?? '';
  const authDate = Number(date);
  if (
    !/^\d+$/.test(date) ||
    !Number.isSafeInteger(authDate) ||
    authDate > now / 1000 + 30 ||
    authDate < now / 1000 - 300
  ) {
    throw new PartyError(
      401,
      'telegram_expired',
      'Reopen the Mini App from Telegram to renew your session.'
    );
  }
  let user: unknown;
  try {
    user = JSON.parse(params.get('user') ?? 'null');
  } catch {
    throw new PartyError(401, 'invalid_telegram', 'Invalid Telegram user.');
  }
  if (
    !user ||
    typeof user !== 'object' ||
    !('id' in user) ||
    typeof user.id !== 'number' ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0
  ) {
    throw new PartyError(401, 'invalid_telegram', 'Telegram user is required.');
  }
  return { id: String(user.id), authDate, launchHash: expected };
}

export function cookie(req: Request, name: string): string {
  const entries = (req.headers.cookie ?? '')
    .split(';')
    .map((value) => value.trim());
  const matches = entries.filter((value) => value.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}

export interface MiniSession {
  id: string;
  principal: string;
  csrf: string;
  expires_at: Date;
}
export const SESSION_COOKIE = '__Host-party';
export const BROWSER_COOKIE = '__Host-party-oauth';
export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
};

export async function session(req: Request): Promise<MiniSession> {
  const token = cookie(req, SESSION_COOKIE);
  if (!/^[\w-]{43}$/.test(token))
    throw new PartyError(
      401,
      'telegram_required',
      'Open Party inside Telegram.'
    );
  const [result] = await rows<MiniSession>(
    'SELECT id, principal, csrf, expires_at FROM party_mini_app_sessions WHERE token_hash=$1 AND expires_at>now()',
    [hash(token)]
  );
  if (!result)
    throw new PartyError(
      401,
      'session_expired',
      'Reopen Party in Telegram to renew your session.'
    );
  return result;
}

export function checkOrigin(req: Request): void {
  if (req.headers.origin !== partyOrigin())
    throw new PartyError(
      403,
      'origin_rejected',
      'Open Party from its configured Mini App.'
    );
}
export function checkCsrf(req: Request, value: MiniSession): void {
  checkOrigin(req);
  if (!constantEqual(req.get('X-Party-CSRF') ?? '', value.csrf)) {
    throw new PartyError(
      403,
      'csrf_rejected',
      'Refresh the Party session and try again.'
    );
  }
}

export async function throttle(
  key: string,
  max: number,
  seconds: number,
  client?: PoolClient
): Promise<void> {
  const [result] = await rows<{ hits: number }>(
    `
    INSERT INTO party_throttles (key, hits, expires_at) VALUES ($1,1,now()+($2 * interval '1 second'))
    ON CONFLICT (key) DO UPDATE SET
      hits=CASE WHEN party_throttles.expires_at<=now() THEN 1 ELSE party_throttles.hits+1 END,
      expires_at=CASE WHEN party_throttles.expires_at<=now() THEN EXCLUDED.expires_at ELSE party_throttles.expires_at END
    RETURNING hits`,
    [identity(key), seconds],
    client
  );
  if (result.hits > max)
    throw new PartyError(
      429,
      'rate_limited',
      'Please wait before trying again.',
      seconds
    );
}
