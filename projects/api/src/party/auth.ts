import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { PARTY_SPOTIFY_SCOPES, SpotifyClient } from '@brewtify/spotify';
import { decrypt, encrypt, generateSalt } from '../services/encryption';
import { PartyError, partyOrigin, required, telegramUrl } from './config';
import { database, hostLock, rows, transaction } from './store';
import {
  BROWSER_COOKIE,
  SESSION_COOKIE,
  checkOrigin,
  constantEqual,
  cookie,
  cookieOptions,
  hash,
  identity,
  secret,
  verifyTelegram,
  type MiniSession,
} from './security';

export function spotify(): SpotifyClient {
  return new SpotifyClient({
    clientId: required('SPOTIFY_CLIENT_ID'),
    redirectUri: required('PARTY_SPOTIFY_REDIRECT_URI'),
  });
}
export interface HostSession {
  id: string;
  principal: string;
  account_key: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  salt: string;
  scopes: string[];
  token_expires_at: Date;
  expires_at: Date;
}

export async function bootstrap(
  req: Request,
  res: Response
): Promise<MiniSession> {
  checkOrigin(req);
  const initData =
    typeof req.body?.initData === 'string' ? req.body.initData : '';
  const verified = verifyTelegram(initData, required('TELEGRAM_BOT_TOKEN'));
  const initHash = verified.launchHash;
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `party-init:${initHash}`,
    ]);
    const [existing] = await rows<MiniSession & { token_hash: string }>(
      'SELECT * FROM party_mini_app_sessions WHERE init_hash=$1',
      [initHash],
      client
    );
    if (existing) {
      if (
        existing.expires_at > new Date() &&
        constantEqual(existing.token_hash, hash(cookie(req, SESSION_COOKIE)))
      )
        return existing;
      throw new PartyError(
        401,
        'launch_replayed',
        'Reopen the Mini App in Telegram for a fresh signed launch.'
      );
    }
    const token = secret();
    const result: MiniSession = {
      id: randomUUID(),
      principal: identity(`telegram:${verified.id}`),
      csrf: secret(),
      expires_at: new Date(Date.now() + 3600_000),
    };
    await client.query(
      'INSERT INTO party_mini_app_sessions (id,token_hash,init_hash,principal,csrf,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        result.id,
        hash(token),
        initHash,
        result.principal,
        result.csrf,
        result.expires_at,
      ]
    );
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: 3600_000 });
    return result;
  });
}

export async function hostFor(
  principal: string,
  client?: PoolClient
): Promise<HostSession> {
  const [host] = await rows<HostSession>(
    'SELECT * FROM party_host_sessions WHERE principal=$1 AND expires_at>now()',
    [principal],
    client
  );
  if (!host)
    throw new PartyError(
      401,
      'host_reconnect',
      'The host must connect Spotify for Party.'
    );
  return host;
}

// Call only while holding the account's hostLock, including refresh and room writes.
export async function accessToken(
  host: HostSession,
  client: PoolClient
): Promise<string> {
  if (host.expires_at <= new Date())
    throw new PartyError(401, 'host_reconnect', 'Party authorization expired.');
  if (host.token_expires_at.getTime() > Date.now() + 60_000)
    return decrypt(host.encrypted_access_token, host.salt);
  try {
    const next = await spotify().refresh(
      decrypt(host.encrypted_refresh_token, host.salt)
    );
    const refresh = next.refreshToken
      ? encrypt(next.refreshToken, host.salt)
      : host.encrypted_refresh_token;
    await client.query(
      `UPDATE party_host_sessions SET encrypted_access_token=$2,encrypted_refresh_token=$3,token_expires_at=$4 WHERE id=$1`,
      [
        host.id,
        encrypt(next.accessToken, host.salt),
        refresh,
        new Date(Date.now() + next.expiresIn * 1000),
      ]
    );
    return next.accessToken;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'invalid_grant'
    ) {
      await transaction(async (tx) => {
        await tx.query('DELETE FROM party_host_sessions WHERE id=$1', [
          host.id,
        ]);
        await tx.query(
          "UPDATE party_rooms SET blocked_reason='host_reconnect' WHERE account_key=$1 AND status IN ('open','locked')",
          [host.account_key]
        );
      }, client);
      throw new PartyError(
        401,
        'host_reconnect',
        'Spotify authorization was revoked. Reconnect Party.'
      );
    }
    throw error;
  }
}

interface Authorization {
  id: string;
  session_id: string;
  principal: string;
  encrypted_verifier: string;
  salt: string;
  status: string;
  error: string | null;
  browser_hash: string | null;
  expires_at: Date;
}

export async function startAuthorization(who: MiniSession): Promise<string> {
  const ticket = secret();
  const verifier = secret();
  const salt = generateSalt();
  await hostLock(`principal:${who.principal}`, (lock) =>
    transaction(async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`party-auth:${who.id}`]
      );
      await client.query(
        "UPDATE party_authorizations SET status='failed',error='superseded',encrypted_verifier='' WHERE session_id=$1 AND status IN ('pending','launched')",
        [who.id]
      );
      const [consuming] = await rows(
        'SELECT id FROM party_authorizations WHERE session_id=$1 AND status=$2 AND expires_at>now()',
        [who.id, 'consuming'],
        client
      );
      if (consuming)
        throw new PartyError(
          409,
          'authorization_busy',
          'Spotify authorization is completing. Please wait.'
        );
      await client.query(
        `INSERT INTO party_authorizations (id,session_id,principal,ticket_hash,encrypted_verifier,salt,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
        [
          randomUUID(),
          who.id,
          who.principal,
          hash(ticket),
          encrypt(verifier, salt),
          salt,
        ]
      );
    }, lock)
  );
  return `${partyOrigin()}/api/party/auth/launch?ticket=${ticket}`;
}

export async function launchAuthorization(
  req: Request,
  res: Response
): Promise<void> {
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
  const state = secret();
  const browser = secret();
  const [flow] = await rows<Authorization>(
    `UPDATE party_authorizations SET status='launched',state_hash=$2,browser_hash=$3
    WHERE ticket_hash=$1 AND status='pending' AND expires_at>now() RETURNING *`,
    [hash(ticket), hash(state), hash(browser)]
  );
  if (!flow)
    throw new PartyError(
      400,
      'authorization_expired',
      'Authorization link expired or was already opened. Start again in Telegram.'
    );
  const challenge = Buffer.from(
    hash(decrypt(flow.encrypted_verifier, flow.salt)),
    'hex'
  ).toString('base64url');
  res.cookie(BROWSER_COOKIE, browser, { ...cookieOptions, maxAge: 600_000 });
  res.redirect(spotify().authorizationUrl({ state, codeChallenge: challenge }));
}

export async function finishAuthorization(
  req: Request,
  res: Response
): Promise<void> {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const browser = cookie(req, BROWSER_COOKIE);
  const [flow] = await rows<Authorization>(
    `UPDATE party_authorizations SET status='consuming'
    WHERE state_hash=$1 AND browser_hash=$2 AND status='launched' AND expires_at>now() RETURNING *`,
    [hash(state), hash(browser)]
  );
  if (!flow || !browser)
    throw new PartyError(
      400,
      'authorization_expired',
      'Authorization expired or browser binding was lost. Start again from Telegram.'
    );
  res.clearCookie(BROWSER_COOKIE, cookieOptions);
  try {
    if (req.query.error || typeof req.query.code !== 'string')
      throw new PartyError(
        400,
        'authorization_cancelled',
        'Spotify authorization was cancelled.'
      );
    const tokens = await spotify().exchange(
      req.query.code,
      decrypt(flow.encrypted_verifier, flow.salt)
    );
    if (!PARTY_SPOTIFY_SCOPES.every((scope) => tokens.scopes.includes(scope)))
      throw new PartyError(
        403,
        'insufficient_scope',
        'Playback permissions were not granted.'
      );
    if (!tokens.refreshToken)
      throw new PartyError(
        502,
        'provider_response',
        'Spotify did not return a refresh token.'
      );
    const profile = await spotify().profile(tokens.accessToken);
    if (
      !required('PARTY_HOST_ALLOWLIST')
        .split(',')
        .map((value) => value.trim())
        .includes(profile.id)
    ) {
      throw new PartyError(
        403,
        'host_not_allowlisted',
        'This Spotify account is not in the private host pilot.'
      );
    }
    const account = identity(`spotify:${profile.id}`);
    await hostLock(`principal:${flow.principal}`, () =>
      hostLock(account, (client) =>
        transaction(async (tx) => {
          const [activeFlow] = await rows<Authorization>(
            'SELECT * FROM party_authorizations WHERE id=$1 AND status=$2 AND expires_at>now() FOR UPDATE',
            [flow.id, 'consuming'],
            tx
          );
          if (!activeFlow)
            throw new PartyError(
              401,
              'authorization_expired',
              'Authorization was disconnected or expired.'
            );
          await tx.query(
            'DELETE FROM party_rooms WHERE account_key=$1 AND expires_at<=now()',
            [account]
          );
          await tx.query(
            'DELETE FROM party_host_sessions WHERE account_key=$1 AND expires_at<=now()',
            [account]
          );
          const [other] = await rows<HostSession>(
            'SELECT * FROM party_host_sessions WHERE account_key=$1 OR principal=$2',
            [account, flow.principal],
            tx
          );
          if (
            other &&
            (other.principal !== flow.principal ||
              other.account_key !== account)
          ) {
            throw new PartyError(
              409,
              'account_in_use',
              'Disconnect the existing Party authorization before connecting another host.'
            );
          }
          const [room] = await rows<{ owner: string; expires_at: Date }>(
            "SELECT owner,expires_at FROM party_rooms WHERE account_key=$1 AND status IN ('open','locked')",
            [account],
            tx
          );
          if (room && room.owner !== flow.principal)
            throw new PartyError(
              409,
              'account_in_use',
              'This Spotify account already hosts a party.'
            );
          const salt = generateSalt();
          await tx.query(
            `INSERT INTO party_host_sessions (id,principal,account_key,encrypted_access_token,encrypted_refresh_token,salt,scopes,token_expires_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(principal) DO UPDATE SET encrypted_access_token=EXCLUDED.encrypted_access_token,
        encrypted_refresh_token=EXCLUDED.encrypted_refresh_token,salt=EXCLUDED.salt,scopes=EXCLUDED.scopes,
        token_expires_at=EXCLUDED.token_expires_at,expires_at=EXCLUDED.expires_at`,
            [
              randomUUID(),
              flow.principal,
              account,
              encrypt(tokens.accessToken, salt),
              encrypt(tokens.refreshToken!, salt),
              salt,
              tokens.scopes,
              new Date(Date.now() + tokens.expiresIn * 1000),
              room?.expires_at ?? new Date(Date.now() + 1800_000),
            ]
          );
          await tx.query(
            "UPDATE party_authorizations SET status='complete',encrypted_verifier='' WHERE id=$1",
            [flow.id]
          );
          await tx.query(
            "UPDATE party_rooms SET blocked_reason=NULL WHERE account_key=$1 AND blocked_reason IN ('host_reconnect','unauthorized','insufficient_scope','premium_required','forbidden')",
            [account]
          );
        }, client)
      )
    );
    res
      .type('html')
      .send(
        `<!doctype html><meta name="viewport" content="width=device-width"><title>Party connected</title><h1>Spotify connected for Party</h1><p>Return to the Telegram window where you started. No song has been queued.</p><a href="${telegramUrl()}">Return to Brewtify</a>`
      );
  } catch (error) {
    const code =
      error instanceof PartyError
        ? error.code
        : 'provider_authorization_failed';
    await database().query(
      "UPDATE party_authorizations SET status='failed',error=$2,encrypted_verifier='' WHERE id=$1",
      [flow.id, code]
    );
    throw error;
  }
}

export async function authorizationStatus(
  who: MiniSession
): Promise<{ status: string; error?: string }> {
  const [flow] = await rows<Authorization>(
    'SELECT * FROM party_authorizations WHERE session_id=$1 AND principal=$2 ORDER BY created_at DESC LIMIT 1',
    [who.id, who.principal]
  );
  if (!flow) return { status: 'idle' };
  if (flow.expires_at <= new Date())
    return { status: 'failed', error: 'authorization_expired' };
  return {
    status:
      flow.status === 'complete'
        ? 'complete'
        : flow.status === 'failed'
          ? 'failed'
          : 'pending',
    ...(flow.error ? { error: flow.error } : {}),
  };
}
