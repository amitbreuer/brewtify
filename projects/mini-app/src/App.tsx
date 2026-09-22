import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { PartyConfigDto } from '@brewtify/shared';
import { initialNavigation, sectionUrl } from './lib/navigation';
import type { Section } from './lib/navigation';
import { telegram } from './lib/telegram';
import { LibraryErrorBoundary } from './features/library/LibraryErrorBoundary';

const Library = lazy(() => import('./features/library/Library'));
const Party = lazy(() => import('./features/party/Party'));
const disabled: PartyConfigDto = { enabled: false, telegramUrl: null, autoEnabled: false };

export default function App() {
  const [launch] = useState(() => initialNavigation(window.location.search, telegram()?.initData));
  const [section, setSection] = useState<Section>(launch.section);
  const [pendingSecret, setPendingSecret] = useState(launch.secret);
  const [config, setConfig] = useState<PartyConfigDto | null>(null);
  const consumeInvite = useCallback(() => setPendingSecret(null), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/party/config', { credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async (response) => {
        if (!response.ok) throw new Error('Party unavailable');
        return response.json() as Promise<PartyConfigDto>;
      })
      .then(setConfig)
      .catch(() => { if (!controller.signal.aborted) setConfig(disabled); });
    telegram()?.ready?.();
    telegram()?.expand?.();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onPop = () => setSection(initialNavigation(window.location.search).section);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(next: Section) {
    setSection(next);
    window.history.pushState(null, '', sectionUrl(window.location.href, next));
  }

  if (!config) return <div className="app-loading" role="status">Loading Brewtify…</div>;
  return (
    <div className={config.enabled ? 'app-shell' : undefined}>
      <Suspense fallback={<div className="app-loading" role="status">Loading…</div>}>
        {config.enabled && section === 'party'
          ? <Party config={config} initialSecret={pendingSecret} onInviteConsumed={consumeInvite} />
          : <div className={config.enabled ? 'library-feature' : undefined}>
              <LibraryErrorBoundary partyEnabled={config.enabled}><Library partyEnabled={config.enabled} /></LibraryErrorBoundary>
            </div>}
      </Suspense>
      {config.enabled && (
        <nav className="section-tabs" aria-label="Main sections">
          <button aria-current={section === 'library' ? 'page' : undefined} onClick={() => navigate('library')}>♫ Library</button>
          <button aria-current={section === 'party' ? 'page' : undefined} onClick={() => navigate('party')}>✦ Party</button>
        </nav>
      )}
    </div>
  );
}
