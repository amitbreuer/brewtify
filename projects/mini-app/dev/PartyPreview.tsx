import { useState } from 'react';
import { Room } from '../src/features/party/Room';
import { PartyDemoClient } from './party-demo';

type View = 'host' | 'guest' | 'start';

function DemoRoom({ isHost, onReconnect }: { isHost: boolean; onReconnect: () => void }) {
  const [client] = useState(() => new PartyDemoClient(isHost));
  const [room, setRoom] = useState(client.room);
  return <Room client={client} initialRoom={room}
    onRoomChange={setRoom} onReconnect={onReconnect} />;
}

export default function PartyPreview() {
  const initial = new URLSearchParams(window.location.search).get('demo');
  const [view, setView] = useState<View>(initial === 'guest' ? 'guest' : initial === 'start' || initial === 'setup' ? 'start' : 'host');
  const [reset, setReset] = useState(0);
  const [premium, setPremium] = useState(false);

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
        {view === 'start' && <p>No Telegram login, provider requests, or real playback. Spotify authorization is simulated in this sample.</p>}
        <nav className="party-actions" aria-label="Preview screens">
          <button className={view === 'host' ? undefined : 'party-secondary'} aria-pressed={view === 'host'} onClick={() => show('host')}>Host view</button>
          <button className={view === 'guest' ? undefined : 'party-secondary'} aria-pressed={view === 'guest'} onClick={() => show('guest')}>Guest view</button>
          <button className={view === 'start' ? undefined : 'party-secondary'} aria-pressed={view === 'start'} onClick={() => show('start')}>Start screen</button>
          <button className="party-secondary" onClick={() => setReset(value => value + 1)}>Reset samples</button>
        </nav>
      </aside>
      {view === 'start' ? (
        <section className="party-card party-stack">
          <h2>Start a party</h2>
          <label className="party-check"><input type="checkbox" checked={premium} onChange={(event) => setPremium(event.target.checked)} />I have Spotify Premium and will host playback.</label>
          <button disabled={!premium} onClick={() => show('host')}>Start party</button>
        </section>
      ) : <DemoRoom key={`${view}-${reset}`} isHost={view === 'host'} onReconnect={() => show('start')} />}
    </main>
    </div>
  );
}
