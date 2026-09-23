import type { PartySessionDto } from '@brewtify/shared';
import { partyFailureMessage } from './messages.ts';

export class PartyError extends Error {
  code: string;
  status: number;
  retryAfterMs: number;

  constructor(message: string, code = 'network_error', status = 0, retryAfterMs = 0) {
    super(message);
    this.name = 'PartyError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class PartyClient {
  private csrfToken = '';

  async request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api/party${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(body !== undefined && this.csrfToken ? { 'X-Party-CSRF': this.csrfToken } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new PartyError('Could not reach Party. Check your connection and try again.');
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const retry = response.headers.get('Retry-After');
      const retryAfterMs = retry
        ? Math.max(0, /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
      throw new PartyError(
        payload?.error?.message || 'Party could not complete that action. Please try again.',
        payload?.error?.code || 'request_failed',
        response.status,
        Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
      );
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }

  async session(initData?: string, signal?: AbortSignal): Promise<PartySessionDto> {
    const session = await this.request<PartySessionDto>('/session', initData === undefined ? undefined : { initData }, signal);
    this.csrfToken = session.csrfToken;
    return session;
  }

  async restore(initData: string, signal?: AbortSignal): Promise<PartySessionDto> {
    try {
      return await this.session(undefined, signal);
    } catch (error) {
      if (!(error instanceof PartyError) || error.status !== 401) throw error;
      return this.session(initData, signal);
    }
  }
}

export function errorText(error: unknown): string {
  if (error instanceof PartyError && (
    ['host_reconnect', 'unauthorized', 'premium_required', 'insufficient_scope', 'device_unavailable', 'delivery_settling'].includes(error.code)
    || error.code.startsWith('itunes_')
  )) {
    return partyFailureMessage(error.code);
  }
  if (error instanceof PartyError && error.status === 401) {
    return 'Your Party session expired or could not be verified. Reopen this Mini App in Telegram. Library login is separate.';
  }
  if (error instanceof PartyError && error.status === 429) {
    const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return `Too many requests. Wait ${seconds} seconds before trying again. Updates will resume automatically.`;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
