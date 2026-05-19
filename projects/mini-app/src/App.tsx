import { useState, useCallback } from 'react';
import { Profile } from './components/Profile';
import { PlaylistList } from './components/PlaylistList';
import { CreatePlaylist } from './components/CreatePlaylist';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<'home' | 'create'>('home');

  const onProfileLoaded = useCallback(() => {}, []);

  const handlePlaylistCreated = () => {
    setRefreshKey((k) => k + 1);
    setView('home');
  };

  if (view === 'create') {
    return <CreatePlaylist onCreated={handlePlaylistCreated} onBack={() => setView('home')} />;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-20">
      <header className="sticky top-0 bg-gray-900 border-b border-gray-700 z-10">
        <Profile onProfileLoaded={onProfileLoaded} />
      </header>

      <main>
        <PlaylistList key={refreshKey} />
      </main>

      <button
        onClick={() => setView('create')}
        className="fixed bottom-6 left-4 right-4 py-4 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl text-lg shadow-lg shadow-green-900/50"
      >
        + Create Playlist
      </button>
    </div>
  );
}
