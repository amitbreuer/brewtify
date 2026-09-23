import { useCallback, useEffect, useRef, useState } from 'react';
import { InvalidSongLink, parsePartySongLink, type PartyRequestDto, type PartySearchResult } from '@brewtify/shared';
import { useToast } from '../../hooks/useToast';
import { errorText, PartyClient, PartyError } from './api';
import { partyFailureMessage } from './messages';
import { SongCard } from './SongCard';

function expired(expiresAt: string) {
  return Date.parse(expiresAt) <= Date.now();
}

export function SongSearch({ client, path, enabled, requests }: {
  client: PartyClient;
  path: string;
  enabled: boolean;
  requests: PartyRequestDto[];
}) {
  const { showToast } = useToast();
  const [url, setUrl] = useState('');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<PartySearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const selecting = useRef(false);
  const receipt = useRef<string | null>(null);

  let link = '';
  try { link = parsePartySongLink(url).url; } catch (failure) {
    if (!(failure instanceof InvalidSongLink)) throw failure;
  }

  useEffect(() => {
    const version = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    let expiration: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      if (!enabled || !link || selecting.current) return;
      setLoading(true);
      setError('');
      try {
        const found = await client.request<PartySearchResult>(`${path}/search`, { url: link }, abort.signal);
        if (abort.signal.aborted || generation.current !== version) return;
        setResult(found);
        if (!found.candidates.length) showToast('Not found', 'info');
        else expiration = setTimeout(() => {
          if (generation.current !== version || selecting.current) return;
          setResult(null);
          setError('This search expired. Search for the song again.');
        }, Math.max(0, Date.parse(found.expiresAt) - Date.now()));
      } catch (failure) {
        if (abort.signal.aborted || generation.current !== version) return;
        setError(errorText(failure));
        setRetryAt(Date.now() + (failure instanceof PartyError ? failure.retryAfterMs : 0));
        setWaiting(failure instanceof PartyError && failure.retryAfterMs > 0);
        showToast(errorText(failure), 'error');
      } finally {
        if (!abort.signal.aborted && generation.current === version) setLoading(false);
      }
    }, 500);
    return () => {
      abort.abort();
      clearTimeout(timer);
      clearTimeout(expiration);
    };
  }, [client, path, enabled, link, retry, showToast]);

  useEffect(() => {
    if (!error || retryAt <= Date.now()) return;
    const timer = setTimeout(() => setWaiting(false), retryAt - Date.now());
    return () => clearTimeout(timer);
  }, [error, retryAt]);

  useEffect(() => {
    const request = requests.find(item => item.id === receipt.current);
    if (!request || !['added', 'failed', 'rejected', 'unavailable', 'needs_review', 'matched'].includes(request.status)) return;
    receipt.current = null;
    selecting.current = false;
    setAdding(false);
    if (request.status === 'added') showToast('Added to the queue', 'success');
    else showToast(request.failureCode ? partyFailureMessage(request.failureCode)
      : request.status === 'unavailable' ? 'Not found'
      : request.status === 'rejected' ? 'This song was not added.'
      : 'This song needs host attention before it can be added.', 'error');
  }, [requests, showToast]);

  function change(value: string) {
    // Invalidate immediately, before the next render/effect can run.
    ++generation.current;
    controller.current?.abort();
    receipt.current = null;
    setUrl(value);
    setResult(null);
    setLoading(false);
    setError('');
    setWaiting(false);
    setRetryAt(0);
    setRetry(value => value + 1);
  }

  const select = useCallback(async (candidate: PartySearchResult['candidates'][number]) => {
    if (selecting.current || waiting || !enabled || controller.current?.signal.aborted || !result || !result.candidates.includes(candidate)) return;
    if (expired(result.expiresAt)) {
      setResult(null);
      setError('This search expired. Search for the song again.');
      return;
    }
    const version = generation.current;
    const signal = controller.current?.signal;
    selecting.current = true;
    setAdding(true);
    setError('');
    try {
      const response = await client.request<{ id: string }>(`${path}/selections`, { selectionToken: candidate.selectionToken }, signal);
      if (signal?.aborted || version !== generation.current) return;
      receipt.current = response.id;
      setResult(null);
      setUrl('');
    } catch (failure) {
      if (signal?.aborted || version !== generation.current) return;
      selecting.current = false;
      setAdding(false);
      const message = failure instanceof PartyError && failure.status === 0
        ? `${errorText(failure)} The request may already exist. Tap the same result to check without adding it twice.`
        : errorText(failure);
      setError(message);
      setRetryAt(Date.now() + (failure instanceof PartyError ? failure.retryAfterMs : 0));
      setWaiting(failure instanceof PartyError && failure.retryAfterMs > 0);
      showToast(message, 'error');
    }
  }, [client, path, enabled, result, waiting, showToast]);

  return (
    <form className="party-card party-stack" onSubmit={event => event.preventDefault()}>
      <h2>Add a song</h2>
      <label className="sr-only" htmlFor="party-song">Spotify or Apple Music song link</label>
      <input id="party-song" value={url} onChange={event => change(event.target.value)} maxLength={2048} autoComplete="off" placeholder="Paste a Spotify or Apple Music link" disabled={!enabled || adding} />
      {loading && <p role="status">Searching…</p>}
      {adding && <p role="status">Adding to Spotify…</p>}
      {error && <div role="alert" className="party-error">{error}</div>}
      {error && !adding && link && <button type="button" className="party-secondary" disabled={!enabled || waiting} onClick={() => change(url)}>Search again</button>}
      {enabled && result && <div className="party-stack" aria-label="Search results">
        {result.candidates.map(candidate => <SongCard key={candidate.id} track={candidate} disabled={adding || waiting} onSelect={() => void select(candidate)} />)}
      </div>}
    </form>
  );
}
