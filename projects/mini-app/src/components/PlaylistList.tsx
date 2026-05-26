import { useEffect, useState } from 'react';
import type { Playlist } from '../lib/types';
import { fetchPlaylists, updatePlaylist, deletePlaylist } from '../lib/api';
import { RefreshIcon, MusicIcon, MinusIcon, SearchIcon } from './Icons';
import { useToast } from '../hooks/useToast';
import logoImg from '../assets/brewtify-logo.jpg';

interface ConfirmDialog {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor?: 'green' | 'red';
  onConfirm: () => void;
}

interface PlaylistListProps {
  onPlaylistClick: (playlistId: string) => void;
}

export function PlaylistList({ onPlaylistClick }: PlaylistListProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConfirmDialog | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { showToast } = useToast();

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
    playlist.managed === true;

  const handleUpdate = (playlistId: string) => {
    const playlist = playlists.find((p) => p.id === playlistId);
    setDialog({
      title: 'Refresh Playlist',
      message: `Refresh "${playlist?.name}" with new randomized tracks?`,
      confirmLabel: 'Refresh',
      confirmColor: 'green',
      onConfirm: async () => {
        setDialog(null);
        setUpdatingId(playlistId);
        try {
          await updatePlaylist(playlistId);
          await loadPlaylists();
        } catch (err: any) {
          showToast(`Update failed: ${err.message}`);
        } finally {
          setUpdatingId(null);
        }
      },
    });
  };

  const handleDelete = (playlist: Playlist) => {
    setDialog({
      title: 'Remove Playlist',
      message: `Remove "${playlist.name}" from your library? This cannot be undone.`,
      confirmLabel: 'Remove',
      confirmColor: 'red',
      onConfirm: async () => {
        setDialog(null);
        try {
          await deletePlaylist(playlist.id);
          await loadPlaylists();
        } catch (err: any) {
          showToast(`Delete failed: ${err.message}`);
        }
      },
    });
  };

  const filteredPlaylists = playlists.filter((p) =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return <div className="p-4 text-[#B3B3B3] text-center">Loading playlists...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-400 text-center">{error}</div>;
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {/* Search bar */}
      <div className="relative mb-2">
        <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#535353]" />
        <input
          type="text"
          placeholder="Search playlists..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 bg-[#282828] border border-[#535353] rounded-xl text-white text-sm placeholder-[#535353] focus:outline-none focus:border-[#1DB954]"
        />
      </div>

      {filteredPlaylists.length === 0 ? (
        <p className="text-[#B3B3B3] text-center py-4">
          {searchQuery ? 'No playlists match your search.' : 'No playlists found.'}
        </p>
      ) : (
        filteredPlaylists.map((playlist) => (
          <div
            key={playlist.id}
            onClick={() => onPlaylistClick(playlist.id)}
            className="flex items-center gap-3 p-3 bg-[#181818] hover:bg-[#282828] rounded-lg transition-colors cursor-pointer"
          >
            {playlist.images[0] ? (
              <img
                src={playlist.images[0].url}
                alt={playlist.name}
                className="w-12 h-12 rounded object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded bg-[#282828] flex items-center justify-center text-[#535353]">
                <MusicIcon size={20} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white font-medium truncate">{playlist.name}</span>
                {hasAutoUpdate(playlist) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUpdate(playlist.id); }}
                    disabled={updatingId === playlist.id}
                    className="text-[#B3B3B3] hover:text-[#1DB954] disabled:opacity-50 shrink-0"
                    title="Refresh playlist"
                  >
                    {updatingId === playlist.id ? (
                      <RefreshIcon size={14} className="animate-spin" />
                    ) : (
                      <RefreshIcon size={14} />
                    )}
                  </button>
                )}
              </div>
              <div className="text-xs text-[#B3B3B3]">{playlist.tracks.total} tracks</div>
            </div>
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => handleDelete(playlist)}
                className="p-2 text-[#B3B3B3] hover:text-red-400 hover:bg-[#282828] rounded"
                title="Remove playlist"
              >
                <MinusIcon size={16} />
              </button>
            </div>
          </div>
        ))
      )}

      {/* Confirm dialog */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#282828] rounded-2xl p-5 w-full max-w-xs flex flex-col gap-4">
            <h3 className="text-white font-semibold text-base">{dialog.title}</h3>
            <p className="text-[#B3B3B3] text-sm">{dialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDialog(null)}
                className="flex-1 py-2.5 bg-[#181818] text-white font-medium rounded-full text-sm"
              >
                Cancel
              </button>
              <button
                onClick={dialog.onConfirm}
                className={`flex-1 py-2.5 font-bold rounded-full text-sm ${
                  dialog.confirmColor === 'red'
                    ? 'bg-red-500 hover:bg-red-400 text-white'
                    : 'bg-[#1DB954] hover:bg-[#1ED760] text-black'
                }`}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}