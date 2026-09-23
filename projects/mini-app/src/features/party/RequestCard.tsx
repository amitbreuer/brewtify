import type { PartyRequestDto } from '@brewtify/shared';
import { partyFailureMessage } from './messages';

function formatDuration(ms: number) {
  return `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
}

const statusText: Record<PartyRequestDto['status'], string> = {
  pending: 'Finding this song on Spotify…',
  matched: 'Confirm this recording before adding',
  needs_review: 'Host is choosing a version',
  approved: 'Adding to Spotify…',
  added: "Added to host’s Spotify queue",
  unavailable: 'No available Spotify version found',
  rejected: 'Declined by host',
  failed: 'Could not add this song',
};

export type RequestAction = 'approve' | 'reject' | 'select' | 'retry';

export function RequestCard({ request, isHost, actionable, busy, onAction }: {
  request: PartyRequestDto;
  isHost: boolean;
  actionable: boolean;
  busy: boolean;
  onAction: (id: string, action: RequestAction, candidateId?: string) => void;
}) {
  const track = request.selected ?? request.source;
  const sourceProvider = request.sourceUrl.startsWith('https://music.apple.com/') ? 'Apple Music' : 'Spotify';
  const unknown = request.failureCode === 'delivery_unknown';
  const reviewable = ['matched', 'needs_review'].includes(request.status);
  return (
    <article className={`party-card party-stack${isHost ? ' party-song-row' : ''}`}>
      <div className="party-track">
        {track?.artwork ? <img src={track.artwork} alt="" loading="lazy" referrerPolicy="no-referrer" /> : isHost && <span className="party-artwork-placeholder" aria-hidden="true" />}
        <div>
          <h3 title={track?.title}>{track?.title ?? 'Finding your song…'}</h3>
          {track && <p title={`${track.artist} · ${track.album}`}>{track.artist} · {track.album}</p>}
          {(!isHost || reviewable) && request.source && request.selected && <p className="party-muted">Original: {request.source.title} — {request.source.artist}</p>}
          {!isHost && <>
            <a href={request.sourceUrl} target="_blank" rel="noopener noreferrer">Original on {sourceProvider}</a>
            {request.selected && <> · <a href={request.selected.url} target="_blank" rel="noopener noreferrer">Listen on Spotify</a></>}
          </>}
        </div>
      </div>
      {(!isHost || request.status !== 'added' || unknown) && <p className={unknown ? 'party-warning' : 'party-status'}>{unknown ? 'Outcome unknown · this song may already be in the Spotify queue' : statusText[request.status]}</p>}
      {request.failureCode && !unknown && <p className="party-muted">{partyFailureMessage(request.failureCode)}</p>}
      {isHost && actionable && (reviewable || request.status === 'failed') && (
        <>
          {reviewable && request.candidates.length > 0 && (
            <details open={request.status === 'needs_review'}>
              <summary>Compare Spotify versions ({request.candidates.length})</summary>
              <ul className="party-candidates">
                {request.candidates.map((candidate) => (
                  <li key={candidate.id} className="party-stack">
                    <p>{candidate.title} — {candidate.artist}</p>
                    <p className="party-muted">{candidate.album} · {formatDuration(candidate.durationMs)} · {candidate.explicit === null ? 'Explicitness unknown' : candidate.explicit ? 'Explicit' : 'Not explicit'}</p>
                    <p className="party-muted">{candidate.evidence.join(' · ')}</p>
                    <button disabled={busy} className="party-secondary" onClick={() => onAction(request.id, 'select', candidate.id)}>Choose this version</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="party-actions">
            {request.status === 'matched' && request.selected && <button disabled={busy} onClick={() => onAction(request.id, 'approve')}>Add this recording</button>}
            {reviewable && <button disabled={busy} className="party-secondary" onClick={() => onAction(request.id, 'reject')}>Skip song</button>}
            {request.status === 'failed' && <button disabled={busy} className="party-secondary" onClick={() => onAction(request.id, 'retry')}>{unknown ? 'Review duplicate risk & retry' : 'Retry song'}</button>}
          </div>
        </>
      )}
    </article>
  );
}
