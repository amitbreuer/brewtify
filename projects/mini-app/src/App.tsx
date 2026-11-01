import { useEffect } from 'react';
import Library from './features/library/Library';
import { LibraryErrorBoundary } from './features/library/LibraryErrorBoundary';
import { telegram } from './lib/telegram';

export default function App() {
  useEffect(() => {
    telegram()?.ready?.();
    telegram()?.expand?.();
  }, []);

  return (
    <LibraryErrorBoundary>
      <Library />
    </LibraryErrorBoundary>
  );
}
