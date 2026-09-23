import { useState } from 'react';
import { Room } from '../src/features/party/Room';
import { DevicePicker } from '../src/features/party/DevicePicker';
import { demoDevices, PartyDemoClient } from './party-demo';

type View = 'host' | 'guest' | 'setup';

function DemoRoom({ isHost, onSetup }: { isHost: boolean; onSetup: () => void }) {
  const [client] = useState(() => new PartyDemoClient(isHost));
  const [room, setRoom] = useState(client.room);
  return <Room client={client} initialRoom={room}
    onRoomChange={setRoom} onReconnect={onSetup} />;
}

export default function PartyPreview() {
  const initial = new URLSearchParams(window.location.search).get('demo');
  const [view, setView] = useState<View>(initial === 'guest' || initial === 'setup' ? initial : 'host');
  const [reset, setReset] = useState(0);
  const [device, setDevice] = useState('');

  function show(next: View) {
    setView(next);
    setReset(value => value + 1);
    const url = new URL(window.location.href);
    url.searchParams.set('demo', next);
    window.history.replaceState(null, '', url);
  }

  return (
    <div className="app-shell">
    <main className="party-page party-stack" style={{ paddingBottom: 48 }}>
      <aside className="party-card party-stack" style={{ borderColor: '#a87932', background: '#302518' }} aria-label="Demo controls">
        <div className="party-heading"><strong>INTERACTIVE PREVIEW</strong><span className="party-badge">Sample data</span></div>
        {view === 'setup' && <p>No Telegram login, provider requests, or real playback. Changes stay in this browser tab. The QR invitation is a placeholder.</p>}
        <nav className="party-actions" aria-label="Preview screens">
          <button className={view === 'host' ? undefined : 'party-secondary'} aria-pressed={view === 'host'} onClick={() => show('host')}>Host view</button>
          <button className={view === 'guest' ? undefined : 'party-secondary'} aria-pressed={view === 'guest'} onClick={() => show('guest')}>Guest view</button>
          <button className={view === 'setup' ? undefined : 'party-secondary'} aria-pressed={view === 'setup'} onClick={() => show('setup')}>Host setup</button>
          <button className="party-secondary" onClick={() => setReset(value => value + 1)}>Reset samples</button>
        </nav>
      </aside>
      {view === 'setup' ? (
        <section className="party-card party-stack">
          <h2>Host setup</h2>
          <p>Spotify playback is connected for Party only (sample state).</p>
          <DevicePicker devices={demoDevices} value={device} onChange={setDevice} onRefresh={() => setDevice('')} busy={false} />
          <p className="party-muted">Friends can add songs immediately. No approvals or display names. Choose where you intend to listen.</p>
          <button disabled={device !== 'living-room'} onClick={() => show('host')}>Create demo party</button>
        </section>
      ) : <DemoRoom key={`${view}-${reset}`} isHost={view === 'host'} onSetup={() => show('setup')} />}
      {view === 'setup' && <footer className="party-muted">Sample songs only. This preview never connects to Spotify or plays music.</footer>}
    </main>
    </div>
  );
}
