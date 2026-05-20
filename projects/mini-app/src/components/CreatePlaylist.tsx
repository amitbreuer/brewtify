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
  onBack: () => void;
}

const TRACK_OPTIONS = [60, 80, 100, 120, 140];

export function CreatePlaylist({ onCreated, onBack }: CreatePlaylistProps) {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [selectedArtists, setSelectedArtists] = useState<Map<string, string>>(new Map());
  const [loadingArtists, setLoadingArtists] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [songCount, setSongCount] = useState(100);
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
    loadArtists();
  }, [loadArtists]);

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

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      if (next.has(genre)) {
        next.delete(genre);
      } else {
        next.add(genre);
      }
      return next;
    });
  };

  // Collect all genres sorted by frequency
  const allGenres = artists.reduce((acc, a) => {
    a.genres.forEach((g) => acc.set(g, (acc.get(g) || 0) + 1));
    return acc;
  }, new Map<string, number>());

  const sortedGenres = Array.from(allGenres.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);

  const filteredArtists = artists.filter((a) => {
    const matchesSearch = !searchQuery ||
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.genres.some((g) => g.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesGenre = selectedGenres.size === 0 ||
      a.genres.some((g) => selectedGenres.has(g));

    return matchesSearch && matchesGenre;
  });

  const handleCreate = async () => {
    if (!playlistName || selectedArtists.size === 0) return;

    setCreating(true);
    setStatus('Creating playlist...');

    try {
      const profile: UserProfile = await fetchProfile();
      const artistIds = Array.from(selectedArtists.keys());
      const artistIdsEncoded = artistIds.join(',');
      const description = `[Auto-update: ${artistIdsEncoded}]`;

      const playlist = await createPlaylist(profile.id, playlistName, description);
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
      setTimeout(() => onCreated(), 1500);
    } catch (err: any) {
      setStatus(`❌ Error: ${err.message}`);
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 bg-gray-900 border-b border-gray-700 z-10 p-4 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-xl">
          ←
        </button>
        <h1 className="text-lg font-semibold">Create Playlist</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-28 flex flex-col gap-5">
        {/* Playlist name */}
        <input
          type="text"
          placeholder="Playlist name"
          value={playlistName}
          onChange={(e) => setPlaylistName(e.target.value)}
          className="w-full p-3 bg-gray-800 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
        />

        {/* Track count - pill buttons */}
        <div>
          <label className="text-sm text-gray-400 mb-2 block">Number of tracks</label>
          <div className="flex gap-2">
            {TRACK_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setSongCount(n)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  songCount === n
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Selected artists chips */}
        {selectedArtists.size > 0 && (
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              Selected ({selectedArtists.size})
            </label>
            <div className="flex flex-wrap gap-2">
              {Array.from(selectedArtists.entries()).map(([id, name]) => (
                <span
                  key={id}
                  className="px-3 py-1 bg-green-900/60 text-green-300 rounded-full text-sm flex items-center gap-1"
                >
                  {name}
                  <button
                    onClick={() => toggleArtist({ id, name } as Artist)}
                    className="text-green-400 hover:text-white ml-1"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Search + Filter row */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search artists..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 p-3 bg-gray-800 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
          />
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`px-4 rounded-xl flex items-center gap-1.5 text-sm font-medium transition-colors ${
              filtersOpen || selectedGenres.size > 0
                ? 'bg-green-600 text-white'
                : 'bg-gray-800 text-gray-400 border border-gray-600 hover:bg-gray-700'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
            {selectedGenres.size > 0 && (
              <span className="bg-white text-green-700 text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                {selectedGenres.size}
              </span>
            )}
          </button>
        </div>

        {/* Filter panel */}
        {filtersOpen && sortedGenres.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-300">Genres</span>
              {selectedGenres.size > 0 && (
                <button
                  onClick={() => setSelectedGenres(new Set())}
                  className="text-xs text-green-400 hover:text-green-300"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {sortedGenres.slice(0, 40).map((genre) => (
                <button
                  key={genre}
                  onClick={() => toggleGenre(genre)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    selectedGenres.has(genre)
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Artist grid - tiles */}
        {loadingArtists ? (
          <div className="text-gray-400 text-center py-8">Loading artists...</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filteredArtists.slice(0, 60).map((artist) => {
              const isSelected = selectedArtists.has(artist.id);
              return (
                <button
                  key={artist.id}
                  onClick={() => toggleArtist(artist)}
                  className={`relative flex flex-col items-center p-3 rounded-xl transition-all ${
                    isSelected
                      ? 'bg-green-600 ring-2 ring-green-400'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  {artist.images[0] ? (
                    <img
                      src={artist.images[0].url}
                      alt={artist.name}
                      className="w-16 h-16 rounded-full object-cover mb-2"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gray-700 mb-2 flex items-center justify-center text-2xl">
                      🎤
                    </div>
                  )}
                  <span className="text-xs text-center leading-tight line-clamp-2 text-white">
                    {artist.name}
                  </span>
                  {isSelected && (
                    <div className="absolute top-1 right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center">
                      <span className="text-green-600 text-xs font-bold">✓</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Status */}
      {status && (
        <div className="fixed bottom-20 left-4 right-4 text-sm text-gray-300 text-center bg-gray-800 py-2 rounded-lg">
          {status}
        </div>
      )}

      {/* Create button - fixed bottom */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-900 border-t border-gray-700">
        <button
          onClick={handleCreate}
          disabled={creating || !playlistName || selectedArtists.size === 0}
          className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-xl text-lg"
        >
          {creating ? 'Creating...' : `Create (${selectedArtists.size} artists, ${songCount} tracks)`}
        </button>
      </div>
    </div>
  );
}
