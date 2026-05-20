import { useState, useCallback } from 'react';
import { Profile } from './components/Profile';
import { PlaylistList } from './components/PlaylistList';
import { CreatePlaylist } from './components/CreatePlaylist';
import { PlaylistDetail } from './components/PlaylistDetail';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<'home' | 'create' | 'detail'>('home');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  const onProfileLoaded = useCallback(() => {}, []);

  const handlePlaylistCreated = () => {
    setRefreshKey((k) => k + 1);
    setView('home');
  };

  const handlePlaylistClick = (playlistId: string) => {
    setSelectedPlaylistId(playlistId);
    setView('detail');
  };

  if (view === 'create') {
    return <CreatePlaylist onCreated={handlePlaylistCreated} onBack={() => setView('home')} />;
  }

  if (view === 'detail' && selectedPlaylistId) {
    return (
      <PlaylistDetail
        playlistId={selectedPlaylistId}
        onBack={() => { setView('home'); setRefreshKey((k) => k + 1); }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#121212] text-white pb-20">
      <header className="sticky top-0 bg-[#121212] border-b border-[#282828] z-10">
        <Profile onProfileLoaded={onProfileLoaded} />
      </header>

      <main>
        <PlaylistList key={refreshKey} onPlaylistClick={handlePlaylistClick} />
      </main>

      <button
        onClick={() => setView('create')}
        className="fixed bottom-6 left-4 right-4 py-4 bg-[#1DB954] hover:bg-[#1ED760] text-black font-bold rounded-full text-lg shadow-lg"
      >
        Create Playlist
      </button>
    </div>
  );
}
