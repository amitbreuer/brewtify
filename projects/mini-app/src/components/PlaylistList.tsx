import { useEffect, useState } from 'react';
import type { Playlist } from '../lib/types';
import { fetchPlaylists, updatePlaylist, deletePlaylist } from '../lib/api';
import { RefreshIcon, MusicIcon, MinusIcon, SearchIcon } from './Icons';
import { useToast } from '../hooks/useToast';
import { ConfirmDialog, ErrorState, PlaylistListSkeleton } from './shared';
import type { ConfirmDialogData } from './shared';

interface PlaylistListProps {
  onPlaylistClick: (playlistId: string) => void;
  onCreateClick?: () => void;
}

export function PlaylistList({ onPlaylistClick, onCreateClick }: PlaylistListProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ConfirmDialogData | null>(null);
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
    return <PlaylistListSkeleton />;
  }

  if (error) {
    return <ErrorState message={error} />;
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
        searchQuery ? (
          <p className="text-[#B3B3B3] text-center py-4">No playlists match your search.</p>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="text-6xl mb-4">🍺</div>
            <h2 className="text-xl font-bold text-white mb-2">No playlists yet</h2>
            <p className="text-[#B3B3B3] text-center text-sm mb-6 max-w-[240px]">
              Brew your first playlist from your favorite artists — fresh tracks, automatically updated.
            </p>
            {onCreateClick && (
              <button
                onClick={onCreateClick}
                className="px-6 py-3 bg-[#1DB954] hover:bg-[#1ED760] text-black font-bold rounded-full text-sm"
              >
                Create Your First Playlist
              </button>
            )}
          </div>
        )
      ) : (
        filteredPlaylists.map((playlist) => (
          <div
            key={playlist.id}
            onClick={() => onPlaylistClick(playlist.id)}
            className="flex items-center gap-3 p-3 bg-[#181818] hover:bg-[#282828] rounded-lg transition-colors cursor-pointer"
          >
            {playlist.images?.[0] ? (
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
              <div className="text-white font-medium truncate">{playlist.name}</div>
              <div className="text-xs text-[#B3B3B3]">{playlist.tracks.total} tracks</div>
            </div>
            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              {hasAutoUpdate(playlist) && (
                <button
                  onClick={() => handleUpdate(playlist.id)}
                  disabled={updatingId === playlist.id}
                  className="p-2.5 text-[#B3B3B3] hover:text-[#1DB954] hover:bg-[#282828] rounded-lg disabled:opacity-50"
                  title="Refresh playlist"
                >
                  {updatingId === playlist.id ? (
                    <RefreshIcon size={20} className="animate-spin" />
                  ) : (
                    <RefreshIcon size={20} />
                  )}
                </button>
              )}
              <button
                onClick={() => handleDelete(playlist)}
                className="p-2.5 text-[#B3B3B3] hover:text-red-400 hover:bg-[#282828] rounded-lg"
                title="Remove playlist"
              >
                <MinusIcon size={20} />
              </button>
            </div>
          </div>
        ))
      )}

      {/* Confirm dialog */}
      {dialog && (
        <ConfirmDialog dialog={dialog} onCancel={() => setDialog(null)} />
      )}
    </div>
  );
}