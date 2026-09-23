import { useCallback, useEffect, useState } from 'react';
import type { PartyConfigDto, PartyRoomDto, PartySessionDto } from '@brewtify/shared';
import { inviteSecret } from '../../lib/navigation';
import { telegram, useTelegramBack } from '../../lib/telegram';
import { PartyClient, errorText } from './api';
import { Room } from './Room';
import { usePolling } from './usePolling';

type AuthStatus = { status: 'idle' | 'pending' | 'complete' | 'failed'; error?: string };

export default function Party({ config, initialSecret, onInviteConsumed }: {
  config: PartyConfigDto;
  initialSecret: string | null;
  onInviteConsumed: () => void;
}) {
  const [client] = useState(() => new PartyClient());
  const [session, setSession] = useState<PartySessionDto | null>(null);
  const [view, setView] = useState<'loading' | 'landing' | 'connecting' | 'room'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [premium, setPremium] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus['status']>('idle');
  const [joinInput, setJoinInput] = useState(initialSecret ? `p_${initialSecret}` : '');
  const [bootKey, setBootKey] = useState(0);
  const initData = telegram()?.initData ?? '';

  const openHostRoom = useCallback(async (current: PartySessionDto, signal?: AbortSignal) => {
    const existing = current.room?.isHost && ['open', 'locked'].includes(current.room.status) ? current.room : null;
    const room = existing ?? (await client.request<{ room: PartyRoomDto }>('/rooms', {}, signal)).room;
    signal?.throwIfAborted();
    setSession({ ...current, room });
    setAuthStatus('idle');
    setView('room');
    setError('');
  }, [client]);

  useEffect(() => {
    if (!initData) return;
    const controller = new AbortController();
    async function bootstrap() {
      try {
        const current = await client.restore(initData, controller.signal);
        setSession(current);
        if (initialSecret) {
          try {
            const result = await client.request<{ room: PartyRoomDto }>('/join', { secret: initialSecret }, controller.signal);
            setSession({ ...current, room: result.room });
            setView('room');
            onInviteConsumed();
          } catch (failure) {
            setError(errorText(failure));
            setView('landing');
          }
          return;
        }
        const auth = await client.request<AuthStatus>('/auth/status', undefined, controller.signal);
        if (auth.status === 'pending') {
          setAuthStatus('pending');
          setView('connecting');
        } else if (current.hostConnected && (!current.room || auth.status === 'complete')) {
          await openHostRoom(current, controller.signal);
        } else {
          setView(current.room ? 'room' : 'landing');
          if (auth.status === 'failed' && !current.hostConnected) setError(auth.error?.replaceAll('_', ' ') || 'Spotify authorization was not completed. You can start again.');
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(errorText(failure));
          setView('landing');
        }
      }
    }
    void bootstrap();
    return () => controller.abort();
  // Consume invitations after joining without restarting bootstrap with the new prop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, initData, bootKey, openHostRoom]);

  const pollAuth = useCallback(async (signal: AbortSignal) => {
    const auth = await client.request<AuthStatus>('/auth/status', undefined, signal);
    if (auth.status === 'complete') {
      try {
        const current = await client.session(undefined, signal);
        setSession(current);
        await openHostRoom(current, signal);
      } catch (failure) {
        if (!signal.aborted) {
          setAuthStatus('idle');
          setView('landing');
          setError(errorText(failure));
        }
      }
      return { stop: true };
    }
    if (auth.status === 'failed' || auth.status === 'idle') {
      setAuthStatus(auth.status);
      setView('landing');
      setError(auth.error?.replaceAll('_', ' ') || 'Authorization was cancelled or expired. Start again to reconnect.');
      return { stop: true };
    }
  }, [client, openHostRoom]);
  const onPollError = useCallback((failure: unknown) => setError(errorText(failure)), []);
  usePolling(authStatus === 'pending', pollAuth, onPollError);

  const back = useCallback(() => setView('landing'), []);
  useTelegramBack(view === 'connecting' || view === 'room', back);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (failure) { setError(errorText(failure)); setView('landing'); } finally { setBusy(false); }
  }

  async function start(forceAuthorization = false) {
    if (!session || (!premium && !session.hostConnected && !forceAuthorization)) return;
    await run(async () => {
      setView('connecting');
      if (session?.hostConnected && !forceAuthorization) {
        await openHostRoom(session);
        return;
      }
      const auth = await client.request<{ authorizationUrl: string }>('/auth/start', { premiumConfirmed: true });
      setAuthStatus('pending');
      const webApp = telegram();
      if (webApp?.openLink) webApp.openLink(auth.authorizationUrl);
      else window.open(auth.authorizationUrl, '_blank', 'noopener,noreferrer');
    });
  }

  async function join() {
    const secret = inviteSecret(joinInput);
    if (!secret) {
      setError('Paste a Telegram party invitation or its p_… code.');
      return;
    }
    await run(async () => {
      const result = await client.request<{ room: PartyRoomDto }>('/join', { secret });
      setSession((current) => current && { ...current, room: result.room });
      setView('room');
      onInviteConsumed();
    });
  }

  if (!initData) {
    let telegramUrl = config.telegramUrl;
    if (telegramUrl && initialSecret) {
      const url = new URL(telegramUrl);
      url.searchParams.set('startapp', `p_${initialSecret}`);
      telegramUrl = url.toString();
    }
    return (
      <main className="party-page party-stack">
        <section className="party-card party-stack">
          <h2>Open Party in Telegram</h2>
          <p>Hosts and guests use the Brewtify Mini App in Telegram. Your Telegram launch is verified; guests do not need a Spotify or Apple Music login.</p>
          {telegramUrl ? <a className="party-button" href={telegramUrl} rel="noreferrer">Open in Telegram</a> : <p>Open your Brewtify bot and send /party. Telegram launch configuration is currently unavailable.</p>}
          <p className="party-muted">Browser-only participation is not supported. Library connection is separate.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="party-page party-stack">
      {view === 'connecting' && <header className="party-heading"><button className="party-secondary" onClick={back}>Back</button></header>}
      {error && <div className="party-error" role="alert">{error}</div>}
      {view === 'loading' && <p role="status">Verifying your Telegram session…</p>}
      {view !== 'loading' && !session && <button disabled={busy} onClick={() => { setError(''); setView('loading'); setBootKey((key) => key + 1); }}>Retry Telegram session</button>}
      {session && view === 'landing' && (
        <>
          {session.room && <button onClick={() => setView('room')}>Return to {session.room.isHost ? 'your party' : 'joined party'}</button>}
          <section className="party-card party-stack">
            <h2>Bring everyone’s songs together</h2>
            <p>Friends join, paste Spotify or Apple Music song links, and add songs straight to your Spotify queue.</p>
            <p className="party-muted">Private pilot · Spotify hosts must be allowlisted. Party needs separate playback permission, not your Library login. Rooms expire after 12 hours.</p>
            {!session.hostConnected && <label className="party-check"><input type="checkbox" checked={premium} onChange={(event) => setPremium(event.target.checked)} />I have Spotify Premium and will host playback.</label>}
            <button disabled={busy || (!premium && !session.hostConnected) || authStatus === 'pending'} onClick={() => void start()}>Start party</button>
            {authStatus === 'pending' && <button className="party-secondary" onClick={() => setView('connecting')}>Authorization in progress</button>}
          </section>
          <form className="party-card party-stack" onSubmit={(event) => { event.preventDefault(); void join(); }}>
            <h2>Join a party</h2>
            <p className="party-muted">No music account or subscription needed as a guest.</p>
            <label htmlFor="party-invite">Telegram invitation link or code</label>
            <input id="party-invite" value={joinInput} maxLength={2048} autoComplete="off" onChange={(event) => setJoinInput(event.target.value)} placeholder="https://t.me/…?startapp=p_…" required />
            <button disabled={busy || !joinInput.trim()}>Join party</button>
          </form>
        </>
      )}
      {session && view === 'connecting' && (
        <section className="party-card party-stack">
          <h2>Connecting Spotify</h2>
          {authStatus === 'pending' ? (
            <>
              <p role="status">Complete Spotify authorization in the browser, then return here. We’ll check for completion while this app is visible.</p>
              <button className="party-secondary" disabled={busy} onClick={() => void start(true)}>Start authorization again</button>
            </>
          ) : <p role="status">Opening your party…</p>}
        </section>
      )}
      {session?.room && view === 'room' && (
        <Room key={session.room.id} client={client} initialRoom={session.room}
          onRoomChange={(room) => setSession((current) => current && { ...current, room, hostConnected: room.isHost && ['closed', 'expired'].includes(room.status) ? false : current.hostConnected })}
          onReconnect={() => void start(true)}
        />
      )}
      {view !== 'room' && <footer className="party-muted">Songs go to Spotify’s queue, not a playlist. Leaving this tab does not end the party.</footer>}
    </main>
  );
}
