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

export function Room({ client, initialRoom, autoEnabled, onRoomChange, onDisconnect, onReconnect }: {
  client: PartyClient;
  initialRoom: PartyRoomDto;
  autoEnabled: boolean;
  onRoomChange: (room: PartyRoomDto) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const [room, setRoom] = useState(initialRoom);
  const [requests, setRequests] = useState<PartyRequestDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [terminalStatus, setTerminalStatus] = useState<'closed' | 'expired' | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
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
    if (window.confirm('Close this party? New requests and unsent additions stop, and Party Spotify credentials are deleted. Tracks already queued remain in Spotify. An in-flight addition cannot be recalled.')) void roomAction('close');
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
    const data = { displayName: name.trim(), url: url.trim() };
    const signature = JSON.stringify(data);
    if (!submission.current || submission.current.signature !== signature) submission.current = { signature, key: crypto.randomUUID() };
    const submissionKey = submission.current.key;
    await run(async () => {
      await client.request(`${path}/requests`, { ...data, submissionKey });
      setUrl('');
      submission.current = null;
      setReceipt('Request received. Watch its status below; it is not added until approved and accepted by Spotify.');
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
      <section className="party-card party-stack">
        <div className="party-heading"><h2>{room.isHost ? 'Your party' : 'You’re invited'}</h2><span className="party-badge">{status}</span></div>
        <p className="party-muted">Expires {new Date(room.expiresAt).toLocaleString()} · {room.mode === 'auto' ? 'Safe matches auto-add' : 'Host approval'}</p>
        {inactive && <p role="status">This party has {status === 'expired' ? 'expired' : 'closed'}. No more songs can be requested or added. Already queued songs remain in Spotify.</p>}
        {room.status === 'locked' && <p role="status">New requests are paused. The host can still moderate existing requests.</p>}
        {room.blockedReason && <div className="party-warning" role="status">{partyFailureMessage(room.blockedReason)}</div>}
        {room.isHost && !inactive && (
          <>
            <div className="party-actions">
              <button disabled={busy} className="party-secondary" onClick={() => void roomAction(room.status === 'locked' ? 'unlock' : 'lock')}>{room.status === 'locked' ? 'Unlock requests' : 'Lock requests'}</button>
              <button disabled={busy} className="party-secondary" onClick={() => void loadDevices()}>Confirm playback device</button>
              <button disabled={busy} className="party-secondary" onClick={onReconnect}>Reconnect Party Spotify</button>
              <button disabled={busy} className="party-danger" onClick={closeRoom}>Close party</button>
              <button disabled={busy} className="party-secondary" onClick={onDisconnect}>Disconnect Party Spotify</button>
            </div>
            {(autoEnabled || room.mode === 'auto') && (
              <label className="party-stack">Moderation mode
                <select value={room.mode} disabled={busy} onChange={(event) => {
                  if (event.target.value === 'auto' && !window.confirm('Automatically add uniquely safe Spotify matches? Ambiguous versions will still require your selection.')) return;
                  void roomAction('mode', { mode: event.target.value });
                }}>
                  <option value="host_approval">Host approval (recommended)</option>
                  <option value="auto" disabled={!autoEnabled}>Auto-add safe matches</option>
                </select>
              </label>
            )}
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
      </section>
      {error && <div className="party-error" role="alert">{error}</div>}
      {room.isHost && !inactive && (
        <section className="party-card party-stack">
          <h2>Invite guests in Telegram</h2>
          {qr && <img className="party-qr" src={qr} alt="QR code opening this party invitation in Telegram" />}
          {inviteUrl ? (
            <>
              <label htmlFor="party-invite-copy">Private invitation · anyone with this link can join</label>
              <input id="party-invite-copy" value={inviteUrl} readOnly onFocus={(event) => event.target.select()} />
              <button className="party-secondary" onClick={() => void copyInvite()}>{copied ? 'Copied!' : 'Copy Telegram invitation'}</button>
            </>
          ) : <p>Invitation unavailable. Reopen the room to retry.</p>}
          <p className="party-muted">Share privately. Guests only see their own request receipts.</p>
        </section>
      )}
      {!inactive && (
        <form className="party-card party-stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <h2>Request a song</h2>
          <label htmlFor="party-name">Display name</label>
          <input id="party-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={40} autoComplete="off" placeholder="How should the host know you?" disabled={room.status !== 'open' || busy} />
          <label htmlFor="party-song">Spotify or Apple Music song link</label>
          <input id="party-song" value={url} onChange={(event) => { setUrl(event.target.value); setReceipt(''); }} required maxLength={2048} autoComplete="off" placeholder="https://open.spotify.com/track/…" disabled={room.status !== 'open' || busy} />
          <p className="party-muted">Individual songs only, not albums, playlists or shortened links. Apple Music versions may need the host to choose a Spotify match.</p>
          <button disabled={busy || room.status !== 'open' || !name.trim() || !url.trim()}>Submit request</button>
          {receipt && <p role="status">{receipt}</p>}
        </form>
      )}
      <section className="party-stack" aria-label={room.isHost ? 'Moderation requests' : 'Your request receipts'}>
        <h2>{room.isHost ? 'Requests & moderation' : 'Your requests'}</h2>
        {pollError && <div className="party-error" role="alert">{pollError}</div>}
        {!loaded && !pollError && <p role="status">Loading requests…</p>}
        {loaded && !requests.length && <p className="party-muted">No requests yet.</p>}
        {requests.map((request) => (
          <RequestCard key={request.id} request={request} isHost={room.isHost} actionable={!inactive} busy={busy} onAction={(id, action, candidate) => void requestAction(id, action, candidate)} />
        ))}
      </section>
    </div>
  );
}
