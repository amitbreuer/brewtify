import type { PartyDevice } from '@brewtify/shared';

export function DevicePicker({ devices, value, onChange, onRefresh, busy }: {
  devices: PartyDevice[];
  value: string;
  onChange: (id: string) => void;
  onRefresh: () => void;
  busy: boolean;
}) {
  return (
    <div className="party-stack">
      <p className="party-muted">Start playing music in Spotify, then select your active device. Brewtify never transfers playback or controls your speaker.</p>
      <label htmlFor="party-device">Active Spotify device</label>
      <select id="party-device" value={value} onChange={(event) => onChange(event.target.value)} disabled={busy}>
        <option value="">Choose a device…</option>
        {devices.map((device) => (
          <option key={device.id} value={device.id} disabled={!device.isActive || device.isRestricted}>
            {device.name}{device.isRestricted ? ' (restricted)' : device.isActive ? ' (active)' : ' (not active)'}
          </option>
        ))}
      </select>
      {!devices.some((device) => device.isActive && !device.isRestricted) && <p role="status">No eligible device found. Open Spotify and start playback, then refresh devices.</p>}
      <button className="party-secondary" disabled={busy} onClick={onRefresh}>Refresh devices</button>
    </div>
  );
}
