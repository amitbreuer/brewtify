import { useState, useEffect, useCallback } from 'react';
import { Profile } from './components/Profile';
import { PlaylistList } from './components/PlaylistList';
import { CreatePlaylist } from './components/CreatePlaylist';
import { PlaylistDetail } from './components/PlaylistDetail';
import { LoginScreen } from './components/LoginScreen';
import { PlusIcon } from './components/Icons';
import { fetchProfile } from './lib/api';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<'loading' | 'login' | 'home' | 'create' | 'detail'>('loading');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile()
      .then(() => setView('home'))
      .catch((err) => {
        if ((err as any).status === 401) {
          setView('login');
        } else {
          setView('home'); // show home, Profile component will display error
        }
      });
  }, []);

  const onProfileLoaded = useCallback(() => {}, []);

  const handleLogout = useCallback(() => {
    setView('login');
  }, []);

  const handlePlaylistCreated = () => {
    setRefreshKey((k) => k + 1);
    setView('home');
  };

  const handlePlaylistClick = (playlistId: string) => {
    setSelectedPlaylistId(playlistId);
    setView('detail');
  };

  if (view === 'loading') {
    return (
      <div className="min-h-screen bg-[#121212] text-white flex items-center justify-center">
        <div className="text-[#B3B3B3]">Loading...</div>
      </div>
    );
  }

  if (view === 'login') {
    return <LoginScreen />;
  }

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
        <Profile onProfileLoaded={onProfileLoaded} onLogout={handleLogout} />
      </header>

      <main>
        <PlaylistList key={refreshKey} onPlaylistClick={handlePlaylistClick} />
      </main>

      {/* Floating create button */}
      <button
        onClick={() => setView('create')}
        className="fixed bottom-6 right-5 w-14 h-14 bg-[#1DB954] hover:bg-[#1ED760] text-black rounded-full shadow-lg flex items-center justify-center"
      >
        <PlusIcon size={28} />
      </button>
    </div>
  );
}
