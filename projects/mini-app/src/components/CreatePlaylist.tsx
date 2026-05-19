import { useState, useCallback, useEffect } from 'react';
import type { Artist, Track, UserProfile } from '../lib/types';
import {
  fetchFollowedArtists,
  fetchAllArtistTracks,
  fetchProfile,
  createPlaylist,
  addTracksToPlaylist,
} from '../lib/api';

interface CreatePlaylistProps {
  onCreated: () => void;
}

export function CreatePlaylist({ onCreated }: CreatePlaylistProps) {
  const [open, setOpen] = useState(false);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [selectedArtists, setSelectedArtists] = useState<Map<string, string>>(new Map());
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [playlistDescription, setPlaylistDescription] = useState('');
  const [songCount, setSongCount] = useState(60);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('');

  const loadArtists = useCallback(async () => {
    setLoadingArtists(true);
    try {
      const all: Artist[] = [];
      let after: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const data = await fetchFollowedArtists(50, after);
        all.push(...data.items);
        after = data.next || undefined;
        hasMore = data.next !== null;
      }

      all.sort((a, b) => b.followers.total - a.followers.total);
      setArtists(all);
    } catch (err: any) {
      console.error('Failed to load artists:', err);
    } finally {
      setLoadingArtists(false);
    }
  }, []);

  useEffect(() => {
    if (open && artists.length === 0) {
      loadArtists();
    }
  }, [open, artists.length, loadArtists]);

  const toggleArtist = (artist: Artist) => {
    setSelectedArtists((prev) => {
      const next = new Map(prev);
      if (next.has(artist.id)) {
        next.delete(artist.id);
      } else {
        next.set(artist.id, artist.name);
      }
      return next;
    });
  };

  const filteredArtists = searchQuery
    ? artists.filter(
        (a) =>
          a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.genres.some((g) => g.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : artists;

  const handleCreate = async () => {
    if (!playlistName || selectedArtists.size === 0) return;

    setCreating(true);
    setStatus('Creating playlist...');

    try {
      const profile: UserProfile = await fetchProfile();
      const artistIds = Array.from(selectedArtists.keys());
      const artistIdsEncoded = artistIds.join(',');

      const finalDescription = playlistDescription
        ? `${playlistDescription} [Auto-update: ${artistIdsEncoded}]`
        : `[Auto-update: ${artistIdsEncoded}]`;

      const playlist = await createPlaylist(profile.id, playlistName, finalDescription);
      setStatus(`Gathering tracks from ${artistIds.length} artists...`);

      const results = await Promise.allSettled(
        artistIds.map((id) => fetchAllArtistTracks(id))
      );

      const allTracks: Track[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allTracks.push(...result.value);
        }
      }

      if (allTracks.length === 0) {
        setStatus('No tracks found!');
        setCreating(false);
        return;
      }

      const shuffled = allTracks.sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, songCount);
      const trackUris = selected.map((t) => t.uri);

      setStatus(`Adding ${selected.length} tracks...`);
      await addTracksToPlaylist(playlist.id, trackUris);

      setStatus(`✅ "${playlistName}" created with ${selected.length} tracks!`);
      setPlaylistName('');
      setPlaylistDescription('');
      setSelectedArtists(new Map());
      onCreated();

      setTimeout(() => {
        setOpen(false);
        setStatus('');
      }, 2000);
    } catch (err: any) {
      setStatus(`❌ Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  if (!open) {
    return (
      <div className="p-4">
        <button
          onClick={() => setOpen(true)}
          className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg"
        >
          + Create Playlist
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Create Playlist</h2>
        <button
          onClick={() => setOpen(false)}
          className="text-gray-400 hover:text-white text-xl"
        >
          ✕
        </button>
      </div>

      <input
        type="text"
        placeholder="Playlist name"
        value={playlistName}
        onChange={(e) => setPlaylistName(e.target.value)}
        className="w-full p-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
      />

      <input
        type="text"
        placeholder="Description (optional)"
        value={playlistDescription}
        onChange={(e) => setPlaylistDescription(e.target.value)}
        className="w-full p-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
      />

      <div className="flex items-center gap-3">
        <label className="text-gray-400 text-sm">Tracks:</label>
        <select
          value={songCount}
          onChange={(e) => setSongCount(Number(e.target.value))}
          className="bg-gray-800 border border-gray-600 rounded-lg text-white p-2 focus:outline-none"
        >
          {[20, 40, 60, 80, 100].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      {selectedArtists.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from(selectedArtists.entries()).map(([id, name]) => (
            <span
              key={id}
              className="px-2 py-1 bg-green-900 text-green-300 rounded-full text-xs flex items-center gap-1"
            >
              {name}
              <button
                onClick={() => toggleArtist({ id, name } as Artist)}
                className="text-green-400 hover:text-white"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div>
        <input
          type="text"
          placeholder="Search artists..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
          }}
          className="w-full p-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
        />
      </div>

      <div className="max-h-60 overflow-y-auto flex flex-col gap-1">
        {loadingArtists ? (
          <div className="text-gray-400 text-center py-4">Loading artists...</div>
        ) : (
          filteredArtists.slice(0, 50).map((artist) => (
            <button
              key={artist.id}
              onClick={() => toggleArtist(artist)}
              className={`flex items-center gap-3 p-2 rounded-lg text-left w-full ${
                selectedArtists.has(artist.id)
                  ? 'bg-green-900/50 border border-green-600'
                  : 'bg-gray-800 hover:bg-gray-700'
              }`}
            >
              {artist.images[0] ? (
                <img src={artist.images[0].url} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-700" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm truncate">{artist.name}</div>
                <div className="text-xs text-gray-400">{artist.followers.total.toLocaleString()} followers</div>
              </div>
              {selectedArtists.has(artist.id) && (
                <span className="text-green-400">✓</span>
              )}
            </button>
          ))
        )}
      </div>

      {status && (
        <div className="text-sm text-gray-300 text-center">{status}</div>
      )}

      <button
        onClick={handleCreate}
        disabled={creating || !playlistName || selectedArtists.size === 0}
        className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-lg"
      >
        {creating ? 'Creating...' : `Create Playlist (${selectedArtists.size} artists)`}
      </button>
    </div>
  );
}
