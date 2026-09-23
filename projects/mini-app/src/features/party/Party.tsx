import { useCallback, useEffect, useState } from 'react';
import type { PartyConfigDto, PartyDevice, PartyRoomDto, PartySessionDto } from '@brewtify/shared';
import { inviteSecret } from '../../lib/navigation';
import { telegram, useTelegramBack } from '../../lib/telegram';
import { PartyClient, errorText } from './api';
import { DevicePicker } from './DevicePicker';
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
  const [view, setView] = useState<'loading' | 'landing' | 'setup' | 'room'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [premium, setPremium] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus['status']>('idle');
  const [devices, setDevices] = useState<PartyDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [joinInput, setJoinInput] = useState(initialSecret ? `p_${initialSecret}` : '');
  const [bootKey, setBootKey] = useState(0);
  const initData = telegram()?.initData ?? '';

  const loadDevices = useCallback(async (signal?: AbortSignal) => {
    const result = await client.request<{ devices: PartyDevice[] }>('/devices', undefined, signal);
    setDevices(result.devices);
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
        } else {
          setView(current.room ? 'room' : current.hostConnected ? 'setup' : 'landing');
        }
        const auth = await client.request<AuthStatus>('/auth/status', undefined, controller.signal);
        setAuthStatus(auth.status);
        if (auth.status === 'pending') setView('setup');
        if (auth.status === 'failed' && !current.hostConnected) setError(auth.error?.replaceAll('_', ' ') || 'Spotify authorization was not completed. You can start again.');
        if (!current.room && current.hostConnected && auth.status !== 'pending') await loadDevices(controller.signal);
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
  }, [client, initData, bootKey, loadDevices]);

  const pollAuth = useCallback(async (signal: AbortSignal) => {
    const auth = await client.request<AuthStatus>('/auth/status', undefined, signal);
    if (auth.status === 'complete') {
      const current = await client.session(undefined, signal);
      setSession(current);
      await loadDevices(signal);
      setAuthStatus('complete');
      setView(current.room?.isHost && ['open', 'locked'].includes(current.room.status) ? 'room' : 'setup');
      setError('');
      return { stop: true };
    }
    if (auth.status === 'failed' || auth.status === 'idle') {
      setAuthStatus(auth.status);
      setError(auth.error?.replaceAll('_', ' ') || 'Authorization was cancelled or expired. Start again to reconnect.');
      return { stop: true };
    }
  }, [client, loadDevices]);
  const onPollError = useCallback((failure: unknown) => setError(errorText(failure)), []);
  usePolling(authStatus === 'pending' || (authStatus === 'complete' && !session?.hostConnected), pollAuth, onPollError);

  const back = useCallback(() => setView('landing'), []);
  useTelegramBack(view === 'setup' || view === 'room', back);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }

  async function start(forceAuthorization = false) {
    if (!premium) return;
    await run(async () => {
      setView('setup');
      if (session?.hostConnected && !forceAuthorization) {
        if (session.room?.isHost && ['open', 'locked'].includes(session.room.status)) {
          setView('room');
          return;
        }
        await loadDevices();
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

  async function createRoom() {
    await run(async () => {
      const result = await client.request<{ room: PartyRoomDto; inviteUrl: string }>('/rooms', { deviceId });
      setSession((current) => current && { ...current, room: result.room });
      setView('room');
    });
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect Party Spotify? This closes your party and deletes its playback credentials. Queued tracks remain; an in-flight addition cannot be recalled. Library stays connected.')) return;
    await run(async () => {
      await client.request('/disconnect', {});
      setSession(await client.session());
      setAuthStatus('idle');
      setView('landing');
      setDevices([]);
      setDeviceId('');
    });
  };

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
      {view === 'setup' && <header className="party-heading"><button className="party-secondary" onClick={back}>Back</button></header>}
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
            <label className="party-check"><input type="checkbox" checked={premium} onChange={(event) => setPremium(event.target.checked)} />I have Spotify Premium and will host playback.</label>
            <button disabled={busy || !premium || authStatus === 'pending'} onClick={() => void start()}>Start party</button>
            {authStatus === 'pending' && <button className="party-secondary" onClick={() => setView('setup')}>Authorization in progress</button>}
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
      {session && view === 'setup' && (
        <section className="party-card party-stack">
          <h2>Host setup</h2>
          {authStatus === 'pending' ? (
            <>
              <p role="status">Complete Spotify authorization in the browser, then return here. We’ll check for completion while this app is visible.</p>
              <p className="party-muted">Your browser and Telegram do not need to share cookies. Reopening Party in Telegram resumes this setup.</p>
              <label className="party-check"><input type="checkbox" checked={premium} onChange={(event) => setPremium(event.target.checked)} />I have Spotify Premium.</label>
              <button className="party-secondary" disabled={busy || !premium} onClick={() => void start(true)}>Start authorization again</button>
            </>
          ) : session.hostConnected ? (
            <>
              <p>Spotify playback is connected for Party only.</p>
              <DevicePicker devices={devices} value={deviceId} onChange={setDeviceId} onRefresh={() => void run(() => loadDevices())} busy={busy} />
              <p className="party-muted">Songs will be added automatically. No test song will be added. Choose only the device where you intend to listen.</p>
              <button disabled={busy || !devices.some((device) => device.id === deviceId && device.isActive && !device.isRestricted)} onClick={() => void createRoom()}>Create party on this device</button>
              <button className="party-secondary" disabled={busy} onClick={() => void disconnect()}>Disconnect Party Spotify</button>
            </>
          ) : (
            <>
              <p>Allowlisted Spotify Premium hosts can connect playback. Library authorization remains separate.</p>
              <label className="party-check"><input type="checkbox" checked={premium} onChange={(event) => setPremium(event.target.checked)} />I have Spotify Premium.</label>
              <button disabled={busy || !premium} onClick={() => void start()}>Connect Spotify for Party</button>
            </>
          )}
        </section>
      )}
      {session?.room && view === 'room' && (
        <Room key={session.room.id} client={client} initialRoom={session.room}
          onRoomChange={(room) => setSession((current) => current && { ...current, room, hostConnected: room.isHost && ['closed', 'expired'].includes(room.status) ? false : current.hostConnected })}
          onReconnect={() => { setAuthStatus('idle'); setView('setup'); setSession((current) => current && { ...current, hostConnected: false }); }}
        />
      )}
      {view !== 'room' && <footer className="party-muted">Songs go to Spotify’s queue, not a playlist. Leaving this tab does not end the party.</footer>}
    </main>
  );
}
