import { useState, useEffect, useCallback } from 'react';
import { Profile } from './components/Profile';
import { PlaylistList } from './components/PlaylistList';
import { CreatePlaylist } from './components/CreatePlaylist';
import { PlaylistDetail } from './components/PlaylistDetail';
import { ArtistsPage } from './components/ArtistsPage';
import { BottomTabs } from './components/BottomTabs';
import { LoginScreen } from './components/LoginScreen';
import { ErrorScreen } from './components/ErrorScreen';
import { PlusIcon } from './components/Icons';
import { fetchProfile } from './lib/api';
import type { UserProfile } from './lib/types';

type Tab = 'playlists' | 'artists';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<'loading' | 'login' | 'home' | 'create' | 'detail' | 'error'>('loading');
  const [activeTab, setActiveTab] = useState<Tab>('playlists');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    fetchProfile()
      .then((p) => {
        setProfile(p);
        setView('home');
      })
      .catch((err) => {
        if ((err as any).status === 401) {
          setView('login');
        } else {
          setView('error');
        }
      });
  }, []);

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

  if (view === 'error') {
    return <ErrorScreen />;
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
    <div className="min-h-screen bg-[#121212] text-white pb-16">
      <header className="sticky top-0 bg-[#121212] border-b border-[#282828] z-10">
        <Profile profile={profile} onLogout={handleLogout} />
      </header>

      <div className={activeTab === 'playlists' ? '' : 'hidden'}>
        <main>
          <PlaylistList key={refreshKey} onPlaylistClick={handlePlaylistClick} onCreateClick={() => setView('create')} />
        </main>

        {/* Floating create button */}
        <button
          onClick={() => setView('create')}
          className="fixed bottom-20 right-5 w-14 h-14 bg-[#1DB954] hover:bg-[#1ED760] text-black rounded-full shadow-lg flex items-center justify-center z-10"
        >
          <PlusIcon size={28} />
        </button>
      </div>

      <div className={activeTab === 'artists' ? '' : 'hidden'}>
        <ArtistsPage />
      </div>

      <BottomTabs activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
