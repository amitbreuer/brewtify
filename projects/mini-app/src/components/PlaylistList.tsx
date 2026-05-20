import { useEffect, useState } from 'react';
import type { Playlist } from '../lib/types';
import { fetchPlaylists, updatePlaylist, deletePlaylist } from '../lib/api';

export function PlaylistList() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadPlaylists = async () => {
    setLoading(true);
    try {
      const data = await fetchPlaylists();
      setPlaylists(data.items);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlaylists();
  }, []);

  const hasAutoUpdate = (playlist: Playlist) =>
    playlist.description?.includes('[Auto-update:');

  const handleUpdate = async (playlistId: string) => {
    setUpdatingId(playlistId);
    try {
      const result = await updatePlaylist(playlistId);
      alert(`Updated with ${result.trackCount} tracks from ${result.artistCount} artists!`);
      await loadPlaylists();
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (playlist: Playlist) => {
    if (!confirm(`Remove "${playlist.name}" from your library?`)) return;
    try {
      await deletePlaylist(playlist.id);
      await loadPlaylists();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  if (loading) {
    return <div className="p-4 text-[#B3B3B3] text-center">Loading playlists...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-400 text-center">{error}</div>;
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <h2 className="text-lg font-semibold text-white mb-2">Your Playlists</h2>
      {playlists.length === 0 ? (
        <p className="text-[#B3B3B3]">No playlists found.</p>
      ) : (
        playlists.map((playlist) => (
          <a
            key={playlist.id}
            href={playlist.external_urls.spotify}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 bg-[#181818] hover:bg-[#282828] rounded-lg transition-colors"
          >
            {playlist.images[0] ? (
              <img
                src={playlist.images[0].url}
                alt={playlist.name}
                className="w-12 h-12 rounded object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded bg-[#282828] flex items-center justify-center text-[#535353]">
                🎵
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-white font-medium truncate">{playlist.name}</div>
              <div className="text-xs text-[#B3B3B3]">{playlist.tracks.total} tracks</div>
            </div>
            <div className="flex gap-1" onClick={(e) => e.preventDefault()}>
              {hasAutoUpdate(playlist) && (
                <button
                  onClick={() => handleUpdate(playlist.id)}
                  disabled={updatingId === playlist.id}
                  className="p-2 text-[#1DB954] hover:bg-[#282828] rounded disabled:opacity-50"
                  title="Refresh playlist"
                >
                  {updatingId === playlist.id ? '⏳' : '🔄'}
                </button>
              )}
              <button
                onClick={() => handleDelete(playlist)}
                className="p-2 text-[#B3B3B3] hover:text-red-400 hover:bg-[#282828] rounded"
                title="Remove playlist"
              >
                🗑️
              </button>
            </div>
          </a>
        ))
      )}
    </div>
  );
}