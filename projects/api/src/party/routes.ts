import express, {
  Router,
  type ErrorRequestHandler,
  type Request,
} from 'express';
import { SpotifyError } from '@brewtify/spotify';
import { createLogger } from '../utils/logger';
import { CatalogError } from './catalog';
import {
  authorizationStatus,
  bootstrap,
  finishAuthorization,
  launchAuthorization,
  startAuthorization,
} from './auth';
import {
  checkPrerequisites,
  partyEnabled,
  PartyError,
  telegramUrl,
} from './config';
import { cleanup, dispatchOutbox, runJob, verifyInternal } from './jobs';
import {
  createRoom,
  currentRoom,
  disconnect,
  feed,
  getRoom,
  invite,
  joinRoom,
  requestAction,
  roomAction,
  roomDto,
  submit,
} from './rooms';
import {
  checkCsrf,
  checkOrigin,
  session,
  throttle,
  type MiniSession,
} from './security';
import { rows } from './store';
import { searchSongs, selectSong, SELECTION_TOKEN_LIMIT } from './resolution';

const log = createLogger('party');
function field(req: Request, key: string, max = 2048): string {
  const value: unknown = req.body?.[key];
  if (typeof value !== 'string' || !value || value.length > max)
    throw new PartyError(400, 'invalid_input', `Invalid ${key}.`);
  return value;
}
function param(req: Request, key: string): string {
  const value = req.params[key];
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new PartyError(400, 'invalid_input', 'Invalid resource identifier.');
  return value;
}
async function summary(who: MiniSession) {
  const room = await currentRoom(who);
  const [host] = await rows(
    'SELECT id FROM party_host_sessions WHERE principal=$1 AND expires_at>now()',
    [who.principal]
  );
  return {
    csrfToken: who.csrf,
    hostConnected: !!host,
    room: room ? roomDto(room, who) : null,
  };
}

export const partyErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next
) => {
  if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    ['entity.too.large', 'entity.parse.failed'].includes(String(error.type))
  ) {
    const large = error.type === 'entity.too.large';
    res
      .status(large ? 413 : 400)
      .json({
        error: {
          code: large ? 'body_too_large' : 'invalid_json',
          message: 'Send a small valid JSON request.',
        },
      });
    return;
  }
  const known =
    error instanceof PartyError ||
    error instanceof SpotifyError ||
    error instanceof CatalogError;
  const status =
    error instanceof CatalogError
      ? error.code === 'invalid_song_link'
        ? 400
        : error.code === 'itunes_rate_limited'
          ? 429
          : 503
      : known &&
          error.status !== undefined &&
          error.status >= 400 &&
          error.status < 600
        ? error.status
        : 503;
  const code = known ? error.code : 'party_unavailable';
  const retryAfter =
    error instanceof PartyError
      ? error.retryAfter
      : error instanceof SpotifyError || error instanceof CatalogError
        ? error.retryAfterSeconds
        : undefined;
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  const storageCode =
    !known &&
    error &&
    typeof error === 'object' &&
    'code' in error &&
    /^[A-Z0-9]{5}$/.test(String(error.code))
      ? String(error.code)
      : undefined;
  log.warn('Party operation failed', {
    code, status, storageCode,
    phase: error instanceof SpotifyError ? error.diagnostics.phase : undefined,
    transportCode: error instanceof SpotifyError ? error.diagnostics.transportCode : undefined,
  });
  res
    .status(status)
    .json({
      error: {
        code,
        message: known
          ? error.message
          : 'Party is temporarily unavailable. Please try again.',
      },
    });
};

export const partyRoutes = Router();
partyRoutes.use((_req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  next();
});
partyRoutes.get('/config', (_req, res) => {
  res.json({
    enabled: partyEnabled(),
    telegramUrl:
      partyEnabled() && process.env.PARTY_TELEGRAM_BOT_USERNAME
        ? telegramUrl()
        : null,
    autoEnabled: partyEnabled(),
  });
});
partyRoutes.use((_req, _res, next) => {
  if (!partyEnabled())
    throw new PartyError(404, 'party_disabled', 'Party is not enabled.');
  checkPrerequisites();
  next();
});
partyRoutes.use(express.json({ limit: '32kb' }));
partyRoutes.get('/auth/launch', launchAuthorization);
partyRoutes.get('/auth/callback', finishAuthorization);
partyRoutes.post('/session', async (req, res) => {
  checkOrigin(req);
  // The default socket address is deliberately used, never an untrusted forwarded header.
  await throttle(
    `bootstrap-ip:${req.socket.remoteAddress ?? 'unknown'}`,
    1200,
    60
  );
  res.json(await summary(await bootstrap(req, res)));
});
partyRoutes.use(async (req, res, next) => {
  const who = await session(req);
  if (req.method !== 'GET') checkCsrf(req, who);
  await throttle(
    `request-ip:${req.socket.remoteAddress ?? 'unknown'}`,
    1200,
    60
  );
  await throttle(`session:${who.id}`, 180, 60);
  res.locals.partySession = who;
  next();
});
function who(res: express.Response): MiniSession {
  return res.locals.partySession;
}
partyRoutes.get('/session', async (_req, res) => {
  res.json(await summary(who(res)));
});
partyRoutes.post('/auth/start', async (_req, res) => {
  await throttle(`auth:${who(res).principal}`, 5, 300);
  res.json({ authorizationUrl: await startAuthorization(who(res)) });
});
partyRoutes.get('/auth/status', async (_req, res) => {
  res.json(await authorizationStatus(who(res)));
});
partyRoutes.post('/disconnect', async (_req, res) => {
  await disconnect(who(res));
  res.json({ ok: true });
});
partyRoutes.post('/rooms', async (req, res) => {
  const mode: unknown = req.body?.mode ?? 'auto';
  if (mode !== 'auto' && mode !== 'host_approval')
    throw new PartyError(
      400,
      'invalid_mode',
      'Invalid party mode.'
    );
  res.status(201).json(await createRoom(who(res), mode));
});
partyRoutes.post('/join', async (req, res) => {
  await throttle(`join:${who(res).principal}`, 12, 60);
  res.json({ room: await joinRoom(who(res), field(req, 'secret', 64)) });
});
partyRoutes.get('/rooms/:id/invite', async (req, res) => {
  res.json({
    inviteUrl: await invite(await getRoom(param(req, 'id')), who(res)),
  });
});
partyRoutes.get('/rooms/:id/requests', async (req, res) => {
  res.json(
    await feed(
      who(res),
      param(req, 'id'),
      typeof req.query.cursor === 'string' ? req.query.cursor : '0'
    )
  );
});
partyRoutes.post('/rooms/:id/search', async (req, res) => {
  res.json(await searchSongs(who(res), param(req, 'id'), field(req, 'url')));
});
partyRoutes.post('/rooms/:id/selections', async (req, res) => {
  res.status(202).json(await selectSong(who(res), param(req, 'id'), field(req, 'selectionToken', SELECTION_TOKEN_LIMIT)));
});
partyRoutes.post('/rooms/:id/requests', async (req, res) => {
  res
    .status(202)
    .json(
      await submit(
        who(res),
        param(req, 'id'),
        req.body?.displayName === undefined ? 'Guest' : field(req, 'displayName', 40),
        field(req, 'url'),
        field(req, 'submissionKey', 80)
      )
    );
});
partyRoutes.post('/rooms/:id/action', async (req, res) => {
  await roomAction(who(res), param(req, 'id'), field(req, 'action', 32), {
    mode:
      typeof req.body?.mode === 'string' ? field(req, 'mode', 32) : undefined,
  });
  res.json({ ok: true });
});
partyRoutes.post('/rooms/:id/requests/:requestId/action', async (req, res) => {
  await requestAction(
    who(res),
    param(req, 'id'),
    param(req, 'requestId'),
    field(req, 'action', 32),
    {
      candidateId:
        typeof req.body?.candidateId === 'string'
          ? field(req, 'candidateId', 64)
          : undefined,
      confirmDuplicateRisk: req.body?.confirmDuplicateRisk === true,
    }
  );
  res.json({ ok: true });
});
partyRoutes.use(partyErrorHandler);

export const internalPartyRoutes = Router();
internalPartyRoutes.use(express.json({ limit: '2kb' }));
internalPartyRoutes.use(async (req, _res, next) => {
  await verifyInternal(req.get('Authorization'));
  next();
});
internalPartyRoutes.post('/jobs', async (req, res) => {
  if (!partyEnabled())
    throw new PartyError(503, 'party_disabled', 'Party processing is paused.');
  checkPrerequisites();
  if (!Number.isSafeInteger(req.body?.generation) || req.body.generation < 0)
    throw new PartyError(400, 'invalid_job', 'Invalid task generation.');
  await runJob(field(req, 'jobId', 80), req.body.generation);
  res.status(204).end();
});
internalPartyRoutes.post('/maintenance', async (_req, res) => {
  const deleted = await cleanup();
  const dispatched = partyEnabled() ? await dispatchOutbox() : 0;
  res.json({ deleted, dispatched });
});
internalPartyRoutes.use(partyErrorHandler);
