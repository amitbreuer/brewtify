import { useCallback, useEffect, useRef, useState } from 'react';
import type { PartyDevice, PartyFeed, PartyRequestDto, PartyRoomDto } from '@brewtify/shared';
import QRCode from 'qrcode';
import { mergeFeed } from '../../lib/navigation';
import { PartyClient, PartyError, errorText } from './api';
import { DevicePicker } from './DevicePicker';
import { RequestCard } from './RequestCard';
import type { RequestAction } from './RequestCard';
import { usePolling } from './usePolling';
import { partyFailureMessage } from './messages';

export function Room({ client, initialRoom, onRoomChange, onReconnect }: {
  client: PartyClient;
  initialRoom: PartyRoomDto;
  onRoomChange: (room: PartyRoomDto) => void;
  onReconnect: () => void;
}) {
  const [room, setRoom] = useState(initialRoom);
  const [requests, setRequests] = useState<PartyRequestDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [terminalStatus, setTerminalStatus] = useState<'closed' | 'expired' | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [receipt, setReceipt] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState<PartyDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [showDevices, setShowDevices] = useState(false);
  const cursor = useRef<string | null>(null);
  const submission = useRef<{ signature: string; key: string } | null>(null);
  const path = `/rooms/${encodeURIComponent(initialRoom.id)}`;
  const status = terminalStatus ?? room.status;
  const inactive = status === 'closed' || status === 'expired';
  const roomChangeRef = useRef(onRoomChange);
  useEffect(() => { roomChangeRef.current = onRoomChange; }, [onRoomChange]);

  const readFeed = useCallback(async (signal?: AbortSignal) => {
    const query = cursor.current ? `?cursor=${encodeURIComponent(cursor.current)}` : '';
    const feed = await client.request<PartyFeed>(`${path}/requests${query}`, undefined, signal);
    setRoom(feed.room);
    roomChangeRef.current(feed.room);
    setRequests((current) => mergeFeed(current, feed.requests));
    cursor.current = feed.nextCursor ?? cursor.current;
    setLoaded(true);
    setPollError('');
    return { stop: (feed.room.status === 'closed' || feed.room.status === 'expired') && feed.requests.length < 50, delay: feed.requests.length >= 50 ? 250 : 3000 };
  }, [client, path]);
  const onPollError = useCallback((failure: unknown) => {
    setPollError(errorText(failure));
    if (failure instanceof PartyError && failure.status === 410) {
      setTerminalStatus(failure.code === 'room_closed' ? 'closed' : 'expired');
    }
  }, []);
  usePolling(true, readFeed, onPollError);

  useEffect(() => {
    if (!room.isHost || inactive) return;
    const controller = new AbortController();
    client.request<{ inviteUrl: string }>(`${path}/invite`, undefined, controller.signal)
      .then(async (result) => {
        setInviteUrl(result.inviteUrl);
        const image = await QRCode.toDataURL(result.inviteUrl, { width: 256, margin: 2, errorCorrectionLevel: 'M' });
        if (!controller.signal.aborted) setQr(image);
      })
      .catch((failure) => { if (!controller.signal.aborted) setError(errorText(failure)); });
    return () => controller.abort();
  }, [client, path, room.isHost, inactive]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }

  async function roomAction(action: string, extra: Record<string, unknown> = {}) {
    await run(async () => {
      await client.request(`${path}/action`, { action, ...extra });
      await readFeed();
    });
  }

  function closeRoom() {
    if (window.confirm('End this party? New songs and unsent additions stop, and Party Spotify disconnects. Already queued songs remain in Spotify. An in-flight addition cannot be recalled.')) void roomAction('close');
  }

  async function requestAction(id: string, action: RequestAction, candidateId?: string) {
    const unknown = action === 'retry' && requests.find((request) => request.id === id)?.failureCode === 'delivery_unknown';
    if (unknown && !window.confirm('Spotify may already have added this song. Retrying may add a duplicate. Do you want to send a new queue command anyway?')) return;
    await run(async () => {
      await client.request(`${path}/requests/${encodeURIComponent(id)}/action`, {
        action, ...(candidateId ? { candidateId } : {}), ...(unknown ? { confirmDuplicateRisk: true } : {}),
      });
      await readFeed();
    });
  }

  async function submit() {
    const data = { url: url.trim() };
    const signature = JSON.stringify(data);
    if (!submission.current || submission.current.signature !== signature) submission.current = { signature, key: crypto.randomUUID() };
    const submissionKey = submission.current.key;
    await run(async () => {
      await client.request(`${path}/requests`, { ...data, submissionKey });
      setUrl('');
      submission.current = null;
      setReceipt('Song submitted.');
      await readFeed();
    });
  }

  async function loadDevices() {
    await run(async () => {
      const result = await client.request<{ devices: PartyDevice[] }>('/devices');
      setDevices(result.devices);
      setShowDevices(true);
    });
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError('Copy is unavailable here. Select and copy the invitation text below.');
    }
  }

  return (
    <div className="party-stack">
      {(room.isHost || inactive || room.status === 'locked' || room.blockedReason) && <section className="party-stack">
        {room.isHost && !inactive && (
          <header className="party-heading">
            <button disabled={busy} className="party-end-button" aria-label="End party" title="End party" onClick={closeRoom}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 3v9M6.3 5.8a9 9 0 1 0 11.4 0" />
              </svg>
            </button>
          </header>
        )}
        {inactive && <p role="status">Party {status === 'expired' ? 'expired' : 'ended'}.</p>}
        {room.status === 'locked' && <p role="status">New songs are paused.</p>}
        {room.blockedReason && <div className="party-warning" role="status">{partyFailureMessage(room.blockedReason)}</div>}
        {room.isHost && !inactive && (room.status === 'locked' || room.blockedReason || showDevices) && (
          <>
            <div className="party-actions">
              {room.status === 'locked' && <button disabled={busy} className="party-secondary" onClick={() => void roomAction('unlock')}>Resume songs</button>}
              {room.blockedReason && room.blockedReason !== 'delivery_unknown' && <>
                <button disabled={busy} className="party-secondary" onClick={() => void loadDevices()}>Confirm playback device</button>
                <button disabled={busy} className="party-secondary" onClick={onReconnect}>Reconnect Spotify</button>
              </>}
            </div>
            {room.blockedReason === 'delivery_unknown' && <button disabled={busy} className="party-secondary" onClick={() => {
              if (window.confirm('A previous command may already have added its song. Acknowledge the uncertainty to resume other requests? This does not retry the unknown request.')) void roomAction('acknowledge_unknown');
            }}>Acknowledge unknown outcome & resume</button>}
            {showDevices && (
              <section className="party-stack">
                <DevicePicker devices={devices} value={deviceId} onChange={setDeviceId} onRefresh={() => void loadDevices()} busy={busy} />
                <button disabled={busy || !devices.some((device) => device.id === deviceId && device.isActive && !device.isRestricted)} onClick={() => void roomAction('device', { deviceId })}>Use this device for new additions</button>
              </section>
            )}
          </>
        )}
      </section>}
      {error && <div className="party-error" role="alert">{error}</div>}
      {room.isHost && !inactive && (
        <section className="party-card party-stack">
          <h2>Invite friends</h2>
          {qr && <img className="party-qr" src={qr} alt="QR code opening this party invitation in Telegram" />}
          {inviteUrl ? (
            <>
              <label className="sr-only" htmlFor="party-invite-copy">Telegram invitation</label>
              <input id="party-invite-copy" value={inviteUrl} readOnly onFocus={(event) => event.target.select()} />
              <button className="party-secondary" onClick={() => void copyInvite()}>{copied ? 'Copied!' : 'Copy invite'}</button>
            </>
          ) : <p>Invitation unavailable. Reopen the room to retry.</p>}
        </section>
      )}
      {!inactive && (
        <form className="party-card party-stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <h2>Add a song</h2>
          <label className="sr-only" htmlFor="party-song">Spotify or Apple Music song link</label>
          <input id="party-song" value={url} onChange={(event) => { setUrl(event.target.value); setReceipt(''); }} required maxLength={2048} autoComplete="off" placeholder="Paste a Spotify or Apple Music link" disabled={room.status !== 'open' || busy} />
          <button disabled={busy || room.status !== 'open' || !url.trim()}>Add song</button>
          {receipt && <p className="sr-only" role="status">{receipt}</p>}
        </form>
      )}
      <section className="party-stack" aria-label={room.isHost ? 'Party songs' : 'Your songs'}>
        <h2>{room.isHost ? 'Party songs' : 'Your songs'}</h2>
        {pollError && <div className="party-error" role="alert">{pollError}</div>}
        {!loaded && !pollError && <p role="status">Loading songs…</p>}
        {loaded && !requests.length && <p className="party-muted">No songs yet. Add the first one.</p>}
        {requests.map((request) => (
          <RequestCard key={request.id} request={request} isHost={room.isHost} actionable={!inactive} busy={busy} onAction={(id, action, candidate) => void requestAction(id, action, candidate)} />
        ))}
      </section>
    </div>
  );
}
