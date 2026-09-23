import type { ReactNode } from 'react';
import type { PartyTrack } from '@brewtify/shared';

export function SongCard({ track, children, onSelect, disabled }: {
  track?: PartyTrack;
  children?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  const content = (
    <>
      <div className="party-track">
        {track?.artwork ? <img src={track.artwork} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="party-artwork-placeholder" aria-hidden="true" />}
        <div>
          <h3 title={track?.title}>{track?.title ?? 'Finding your song…'}</h3>
          {track && <p title={`${track.artist} · ${track.album}`}>{track.artist} · {track.album}</p>}
        </div>
      </div>
      {children}
    </>
  );
  return onSelect
    ? <button type="button" className="party-card party-stack party-song-row party-song-choice" onClick={onSelect} disabled={disabled}>{content}</button>
    : <article className="party-card party-stack party-song-row">{content}</article>;
}
