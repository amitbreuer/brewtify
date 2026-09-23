export function partyEnabled(): boolean {
  return process.env.PARTY_ENABLED === 'true';
}

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new PartyError(
      503,
      'configuration_required',
      `Party configuration missing: ${name}`
    );
  return value;
}

export class PartyError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number
  ) {
    super(message);
  }
}

export function partyOrigin(): string {
  const url = new URL(required('PARTY_PUBLIC_ORIGIN'));
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new PartyError(
      503,
      'configuration_required',
      'Party requires an HTTPS public origin.'
    );
  }
  return url.origin;
}

export function telegramUrl(payload = 'party'): string {
  const username = required('PARTY_TELEGRAM_BOT_USERNAME');
  if (
    !/^[A-Za-z0-9_]{5,32}$/.test(username) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(payload)
  ) {
    throw new PartyError(
      503,
      'configuration_required',
      'Invalid Telegram Mini App configuration.'
    );
  }
  return `https://t.me/${username}?startapp=${payload}`;
}

export function checkPrerequisites(): void {
  partyOrigin();
  telegramUrl();
  for (const name of [
    'DATABASE_URL',
    'ENCRYPTION_KEY',
    'TELEGRAM_BOT_TOKEN',
    'PARTY_IDENTITY_KEY',
    'SPOTIFY_CLIENT_ID',
    'PARTY_SPOTIFY_REDIRECT_URI',
    'PARTY_TASKS_PROJECT',
    'PARTY_TASKS_LOCATION',
    'PARTY_TASKS_QUEUE',
    'PARTY_TASKS_SERVICE_ACCOUNT',
    'PARTY_TASKS_AUDIENCE',
  ])
    required(name);
  if (!/^[a-f0-9]{64}$/i.test(required('PARTY_IDENTITY_KEY'))) {
    throw new PartyError(
      503,
      'configuration_required',
      'PARTY_IDENTITY_KEY must be a 32-byte hex key.'
    );
  }
  if (
    required('PARTY_SPOTIFY_REDIRECT_URI') !==
    `${partyOrigin()}/api/party/auth/callback`
  ) {
    throw new PartyError(
      503,
      'configuration_required',
      'Party callback must use its dedicated public origin.'
    );
  }
}
