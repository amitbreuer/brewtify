import { useState, useCallback } from 'react';
import { Profile } from './components/Profile';
import { PlaylistList } from './components/PlaylistList';
import { CreatePlaylist } from './components/CreatePlaylist';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  const onProfileLoaded = useCallback(() => {}, []);

  const handlePlaylistCreated = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="sticky top-0 bg-gray-900 border-b border-gray-700 z-10">
        <Profile onProfileLoaded={onProfileLoaded} />
      </header>

      <main>
        <CreatePlaylist onCreated={handlePlaylistCreated} />
        <PlaylistList key={refreshKey} />
      </main>
    </div>
  );
}
