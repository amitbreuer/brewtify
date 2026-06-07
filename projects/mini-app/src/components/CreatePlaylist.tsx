import { useState, useEffect } from 'react';
import type { Artist, Track, UserProfile } from '../lib/types';
import {
  fetchAllArtistTracks,
  fetchProfile,
  createPlaylist,
  addTracksToPlaylist,
  fetchPlaylists,
} from '../lib/api';
import { MinusIcon } from './Icons';
import { TRACK_OPTIONS, SCHEDULE_OPTIONS } from '../lib/constants';
import { useFollowedArtists } from '../hooks/useFollowedArtists';
import { useArtistWeights } from '../hooks/useArtistWeights';
import {
  ArtistTile,
  ArtistSearchBar,
  GenreFilterPanel,
  WeightControl,
  WeightValidation,
  PageHeader,
} from './shared';

interface CreatePlaylistProps {
  onCreated: () => void;
  onBack: () => void;
}

export function CreatePlaylist({ onCreated, onBack }: CreatePlaylistProps) {
  const [selectedArtists, setSelectedArtists] = useState<Map<string, string>>(new Map());
  const [playlistName, setPlaylistName] = useState('');
  const [songCount, setSongCount] = useState(100);
  const [eraPreferences, setEraPreferences] = useState<Map<string, number>>(new Map());
  const [schedule, setSchedule] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<'success' | 'error' | null>(null);
  const [customized, setCustomized] = useState(false);

  useEffect(() => {
    fetchPlaylists().then((data) => {
      const managedCount = data.items.filter((p: any) => p.managed).length;
      setPlaylistName(`Artists Mix #${managedCount + 1}`);
    }).catch(() => {
      setPlaylistName('Artists Mix #1');
    });
  }, []);

  const artistIds = Array.from(selectedArtists.keys());

  const {
    filteredArtists,
    loading: loadingArtists,
    searchQuery,
    setSearchQuery,
    selectedGenres,
    toggleGenre,
    clearGenres,
    sortedGenres,
    filtersOpen,
    setFiltersOpen,
  } = useFollowedArtists();

  const {
    weights: artistWeights,
    hasCustomWeights,
    totalWeight,
    isWeightValid,
    displayPercentages,
    setWeight,
    enableCustomWeights,
    resetToEqual,
    removeArtist,
  } = useArtistWeights({ artistIds });

  const toggleArtist = (artist: Artist) => {
    setSelectedArtists((prev) => {
      const next = new Map(prev);
      if (next.has(artist.id)) {
        next.delete(artist.id);
        removeArtist(artist.id);
        setEraPreferences((ep) => { const m = new Map(ep); m.delete(artist.id); return m; });
      } else {
        next.set(artist.id, artist.name);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!playlistName || selectedArtists.size === 0) return;

    setCreating(true);
    setCreateResult(null);

    try {
      const profile: UserProfile = await fetchProfile();

      let weights: Record<string, number> | undefined;
      if (hasCustomWeights) {
        weights = {};
        artistIds.forEach((id) => { weights![id] = displayPercentages.get(id) || 0; });
      }

      const eraPreferencesObj: Record<string, number> = {};
      artistIds.forEach((id) => { eraPreferencesObj[id] = eraPreferences.get(id) ?? 50; });

      const playlist = await createPlaylist({
        userId: profile.id,
        name: playlistName,
        artistIds,
        trackCount: songCount,
        weights,
        eraPreferences: eraPreferencesObj,
        schedule,
      });

      const results = await Promise.allSettled(
        artistIds.map((id) => fetchAllArtistTracks(id))
      );

      const artistTrackMap = new Map<string, Track[]>();
      artistIds.forEach((id, index) => {
        const result = results[index];
        if (result.status === 'fulfilled') {
          artistTrackMap.set(id, result.value);
        }
      });

      if (artistTrackMap.size === 0) {
        setCreateResult('error');
        setCreating(false);
        setTimeout(() => setCreateResult(null), 2000);
        return;
      }

      const totalPct = Array.from(artistTrackMap.keys()).reduce(
        (sum, id) => sum + (displayPercentages.get(id) || 0), 0
      );

      let selected: Track[] = [];
      let allocated = 0;
      const entries = Array.from(artistTrackMap.entries());

      for (let i = 0; i < entries.length; i++) {
        const [artistId, tracks] = entries[i];
        const pct = displayPercentages.get(artistId) || Math.round(100 / entries.length);
        const quota = i === entries.length - 1
          ? songCount - allocated
          : Math.round((pct / totalPct) * songCount);

        const sorted = tracks
          .filter((t) => t.album?.release_date)
          .sort((a, b) => (a.album.release_date! > b.album.release_date! ? 1 : -1));
        const undated = tracks.filter((t) => !t.album?.release_date);

        const artistEra = eraPreferences.get(artistId) ?? 50;
        let artistSelected: Track[];
        if (artistEra === 50 || sorted.length === 0) {
          const shuffled = [...tracks].sort(() => Math.random() - 0.5);
          artistSelected = shuffled.slice(0, quota);
        } else {
          const bias = artistEra / 100;
          const weighted = sorted.map((track, idx) => {
            const position = sorted.length > 1 ? idx / (sorted.length - 1) : 0.5;
            const weight = Math.pow(bias < 0.5 ? (1 - position) : position, 2 + Math.abs(bias - 0.5) * 6);
            return { track, weight: weight + Math.random() * 0.1 };
          });
          weighted.sort((a, b) => b.weight - a.weight);
          artistSelected = weighted.slice(0, quota).map((w) => w.track);
          if (artistSelected.length < quota) {
            const shuffledUndated = undated.sort(() => Math.random() - 0.5);
            artistSelected.push(...shuffledUndated.slice(0, quota - artistSelected.length));
          }
        }

        selected.push(...artistSelected);
        allocated += artistSelected.length;
      }

      selected = selected.sort(() => Math.random() - 0.5);
      const trackUris = selected.map((t) => t.uri);

      await addTracksToPlaylist(playlist.id, trackUris);

      setCreateResult('success');
      setTimeout(() => onCreated(), 1500);
    } catch (err: any) {
      setCreateResult('error');
      setCreating(false);
      setTimeout(() => setCreateResult(null), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#121212] text-white flex flex-col">
      <PageHeader title="Create Playlist" onBack={onBack} />

      <div className="flex-1 overflow-y-auto p-4 pb-28 flex flex-col gap-5">
        {/* Playlist name */}
        <input
          type="text"
          placeholder="Playlist name"
          value={playlistName}
          onChange={(e) => setPlaylistName(e.target.value)}
          className="w-full p-3 bg-[#282828] border border-[#535353] rounded-xl text-white placeholder-[#535353] focus:outline-none focus:border-[#1DB954]"
        />

        {/* Track count */}
        <div>
          <label className="text-sm text-[#B3B3B3] mb-2 block">Number of tracks</label>
          <div className="flex gap-2">
            {TRACK_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setSongCount(n)}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${
                  songCount === n
                    ? 'bg-[#1DB954] text-black'
                    : 'bg-[#282828] text-[#B3B3B3] hover:bg-[#333333]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Auto-refresh schedule */}
        <div>
          <label className="text-sm text-[#B3B3B3] mb-2 block">Auto-refresh schedule</label>
          <div className="flex gap-2">
            {SCHEDULE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setSchedule(opt.value)}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${
                  schedule === opt.value
                    ? 'bg-[#1DB954] text-black'
                    : 'bg-[#282828] text-[#B3B3B3] hover:bg-[#333333]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Selected artists with weights and era */}
        {selectedArtists.size > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[#B3B3B3]">
                Selected ({selectedArtists.size})
              </label>
              {customized ? (
                <button
                  onClick={() => { resetToEqual(); setCustomized(false); }}
                  className="text-xs text-[#1DB954] hover:text-[#1ED760]"
                >
                  Reset defaults
                </button>
              ) : (
                <button
                  onClick={() => { enableCustomWeights(); setCustomized(true); }}
                  className="text-xs text-[#1DB954] hover:text-[#1ED760]"
                >
                  Customize
                </button>
              )}
            </div>
            {customized && hasCustomWeights && (
              <WeightValidation totalWeight={totalWeight} isValid={isWeightValid} />
            )}
            <div className="flex flex-col gap-2">
              {Array.from(selectedArtists.entries()).map(([id, name]) => (
                <div
                  key={id}
                  className="flex flex-col gap-1.5 px-3 py-2 bg-[#181818] rounded-xl"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white flex-1 truncate">{name}</span>
                    {customized && (
                      <WeightControl
                        value={artistWeights.get(id)}
                        onChange={(v) => setWeight(id, v)}
                      />
                    )}
                    {!customized && (
                      <span className="text-xs text-[#535353]">
                        {displayPercentages.get(id) || 0}%
                      </span>
                    )}
                    <button
                      onClick={() => toggleArtist({ id, name } as Artist)}
                      className="text-[#B3B3B3] hover:text-red-400 ml-1"
                    >
                      <MinusIcon size={14} />
                    </button>
                  </div>
                  {/* Per-artist era slider — always visible, disabled until customized */}
                  <div className={!customized ? 'opacity-50' : ''}>
                    <label className="text-[10px] text-[#B3B3B3] mb-0.5 block text-center">Era</label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      disabled={!customized}
                      value={eraPreferences.get(id) ?? 50}
                      onChange={(e) => setEraPreferences((prev) => new Map(prev).set(id, Number(e.target.value)))}
                      className={`w-full h-1.5 rounded-full appearance-none bg-[#535353] accent-[#1DB954] ${customized ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                    />
                    <div className="flex justify-between text-[10px] text-[#B3B3B3] mt-0.5">
                      <span>Older</span>
                      <span className={(eraPreferences.get(id) ?? 50) === 50 ? 'text-[#1DB954]' : ''}>Mixed</span>
                      <span>Newer</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Artists section */}
        <h2 className="text-sm font-semibold text-white mt-1">Your Followed Artists</h2>

        <ArtistSearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen(!filtersOpen)}
          selectedGenreCount={selectedGenres.size}
        />

        {filtersOpen && sortedGenres.length > 0 && (
          <GenreFilterPanel
            genres={sortedGenres}
            selectedGenres={selectedGenres}
            onToggle={toggleGenre}
            onClear={clearGenres}
          />
        )}

        {/* Artist grid */}
        {loadingArtists ? (
          <div className="text-[#B3B3B3] text-center py-8">Loading artists...</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filteredArtists.slice(0, 60).map((artist) => (
              <ArtistTile
                key={artist.id}
                artist={artist}
                isSelected={selectedArtists.has(artist.id)}
                onClick={() => toggleArtist(artist)}
              />
            ))}
          </div>
        )}
      </div>


      {/* Create button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#121212] border-t border-[#282828]">
        <button
          onClick={handleCreate}
          disabled={creating || !playlistName || selectedArtists.size === 0 || !isWeightValid}
          className={`w-full py-4 font-bold rounded-full text-lg ${
            createResult === 'success'
              ? 'bg-[#1DB954] text-black'
              : createResult === 'error'
              ? 'bg-[#282828] text-[#B3B3B3]'
              : 'bg-[#1DB954] hover:bg-[#1ED760] disabled:bg-[#282828] disabled:text-[#535353] text-black'
          }`}
        >
          {createResult === 'success'
            ? '✓ Created!'
            : createResult === 'error'
            ? '✗ Failed'
            : creating
            ? 'Creating...'
            : `Create (${selectedArtists.size} artists, ${songCount} tracks)`}
        </button>
      </div>
    </div>
  );
}
