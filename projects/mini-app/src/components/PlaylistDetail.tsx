import { useState, useEffect, useCallback } from 'react';
import type { Playlist, Artist } from '../lib/types';
import {
  fetchPlaylist,
  fetchArtistsByIds,
  fetchFollowedArtists,
  updatePlaylist,
  fetchPlaylistSettings,
  updatePlaylistSettings,
} from '../lib/api';
import { MusicIcon, MicIcon, MinusIcon, CheckIcon, RefreshIcon } from './Icons';

interface PlaylistDetailProps {
  playlistId: string;
  onBack: () => void;
}

interface PlaylistSettings {
  artistIds: string[];
  weights: Map<string, number>;
  era: number;
  count: number;
  schedule: string | null;
}

const TRACK_OPTIONS = [60, 80, 100, 120, 140];
const SCHEDULE_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

export function PlaylistDetail({ playlistId, onBack }: PlaylistDetailProps) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [settings, setSettings] = useState<PlaylistSettings>({ artistIds: [], weights: new Map(), era: 50, count: 100, schedule: null });
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [allArtists, setAllArtists] = useState<Artist[]>([]);
  const [loadingAllArtists, setLoadingAllArtists] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);

  const loadPlaylist = useCallback(async () => {
    setLoading(true);
    try {
      const pl = await fetchPlaylist(playlistId);
      setPlaylist(pl);

      // Load settings from DB
      const dbSettings = await fetchPlaylistSettings(playlistId);
      if (dbSettings.managed && dbSettings.artistIds) {
        const weights = new Map<string, number>();
        if (dbSettings.weights) {
          Object.entries(dbSettings.weights).forEach(([id, w]) => weights.set(id, w as number));
        }
        const parsed: PlaylistSettings = {
          artistIds: dbSettings.artistIds,
          weights,
          era: dbSettings.eraPreference ?? 50,
          count: dbSettings.trackCount ?? 100,
          schedule: dbSettings.schedule ?? null,
        };
        setSettings(parsed);

        if (parsed.artistIds.length > 0) {
          const artistData = await fetchArtistsByIds(parsed.artistIds);
          setArtists(artistData);
        }
      }
    } catch (err: any) {
      setStatus(`❌ ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    loadPlaylist();
  }, [loadPlaylist]);

  const loadAllArtists = async () => {
    if (allArtists.length > 0) return;
    setLoadingAllArtists(true);
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
      setAllArtists(all);
    } catch (err: any) {
      console.error('Failed to load artists:', err);
    } finally {
      setLoadingAllArtists(false);
    }
  };

  const handleEnterEditMode = () => {
    setEditMode(true);
    loadAllArtists();
  };

  const toggleArtist = (artist: Artist) => {
    const isSelected = settings.artistIds.includes(artist.id);
    let newIds: string[];
    let newArtists: Artist[];
    const newWeights = new Map(settings.weights);

    if (isSelected) {
      newIds = settings.artistIds.filter((id) => id !== artist.id);
      newArtists = artists.filter((a) => a.id !== artist.id);
      newWeights.delete(artist.id);
    } else {
      newIds = [...settings.artistIds, artist.id];
      newArtists = [...artists, artist];
    }

    setSettings({ ...settings, artistIds: newIds, weights: newWeights });
    setArtists(newArtists);
    setDirty(true);
  };

  const setWeight = (artistId: string, weight: number) => {
    const newWeights = new Map(settings.weights);
    const clampedWeight = Math.max(0, Math.min(100, weight));
    
    // Calculate sum excluding the current artist
    const othersSum = settings.artistIds
      .filter(id => id !== artistId)
      .reduce((sum, id) => sum + (settings.weights.get(id) || 0), 0);
    
    // Ensure total doesn't exceed 100
    const maxAllowed = 100 - othersSum;
    const finalWeight = Math.min(clampedWeight, maxAllowed);
    
    newWeights.set(artistId, finalWeight);
    setSettings({ ...settings, weights: newWeights });
    setDirty(true);
  };

  const hasCustomWeights = settings.weights.size > 0;

  // Validation: check if total weights = 100%
  const getTotalWeight = (): number => {
    if (!hasCustomWeights || settings.artistIds.length === 0) return 100;
    return settings.artistIds.reduce(
      (sum, id) => sum + (settings.weights.get(id) || 0),
      0
    );
  };
  const totalWeight = getTotalWeight();
  const isWeightValid = !hasCustomWeights || totalWeight === 100;

  const getDisplayPercentages = (): Map<string, number> => {
    const count = settings.artistIds.length;
    if (count === 0) return new Map();

    if (!hasCustomWeights) {
      const equal = Math.round(100 / count);
      const result = new Map<string, number>();
      settings.artistIds.forEach((id) => result.set(id, equal));
      return result;
    }

    const totalWeight = settings.artistIds.reduce(
      (sum, id) => sum + (settings.weights.get(id) || Math.round(100 / count)),
      0
    );
    const result = new Map<string, number>();
    settings.artistIds.forEach((id) => {
      const w = settings.weights.get(id) || Math.round(100 / count);
      result.set(id, Math.round((w / totalWeight) * 100));
    });
    return result;
  };

  const displayPercentages = getDisplayPercentages();

  const handleRefresh = async () => {
    setUpdating(true);
    setStatus('Refreshing playlist...');
    try {
      const result = await updatePlaylist(playlistId);
      setStatus(`✅ Updated with ${result.trackCount} tracks from ${result.artistCount} artists!`);
      await loadPlaylist();
    } catch (err: any) {
      setStatus(`❌ ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus('Saving settings...');
    try {
      const weightsObj = settings.weights.size > 0
        ? Object.fromEntries(settings.weights)
        : null;
      await updatePlaylistSettings(playlistId, {
        artistIds: settings.artistIds,
        trackCount: settings.count,
        weights: weightsObj,
        eraPreference: settings.era,
        schedule: settings.schedule,
      });
      setDirty(false);
      setEditMode(false);
      setStatus('✅ Settings saved!');
      await loadPlaylist();
    } catch (err: any) {
      setStatus(`❌ ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndRefresh = async () => {
    setSaving(true);
    setStatus('Saving & refreshing...');
    try {
      const weightsObj = settings.weights.size > 0
        ? Object.fromEntries(settings.weights)
        : null;
      await updatePlaylistSettings(playlistId, {
        artistIds: settings.artistIds,
        trackCount: settings.count,
        weights: weightsObj,
        eraPreference: settings.era,
        schedule: settings.schedule,
      });
      setDirty(false);
      setEditMode(false);
      setStatus('Refreshing playlist...');
      setUpdating(true);
      const result = await updatePlaylist(playlistId);
      setStatus(`✅ Saved & refreshed with ${result.trackCount} tracks!`);
      await loadPlaylist();
    } catch (err: any) {
      setStatus(`❌ ${err.message}`);
    } finally {
      setSaving(false);
      setUpdating(false);
    }
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      if (next.has(genre)) next.delete(genre);
      else next.add(genre);
      return next;
    });
  };

  // Collect genres from all followed artists
  const allGenres = allArtists.reduce((acc, a) => {
    a.genres.forEach((g) => acc.set(g, (acc.get(g) || 0) + 1));
    return acc;
  }, new Map<string, number>());

  const sortedGenres = Array.from(allGenres.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);

  const filteredAllArtists = allArtists.filter((a) => {
    const matchesSearch = !searchQuery ||
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.genres.some((g) => g.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesGenre = selectedGenres.size === 0 ||
      a.genres.some((g) => selectedGenres.has(g));
    return matchesSearch && matchesGenre;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-[#121212] text-white flex items-center justify-center">
        <span className="text-[#B3B3B3]">Loading...</span>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="min-h-screen bg-[#121212] text-white flex items-center justify-center">
        <span className="text-red-400">Playlist not found</span>
      </div>
    );
  }

  const isAutoUpdate = settings.artistIds.length > 0;

  return (
    <div className="min-h-screen bg-[#121212] text-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 bg-[#121212] border-b border-[#282828] z-10 p-4 flex items-center gap-3">
        <button onClick={onBack} className="text-[#B3B3B3] hover:text-white text-xl">
          ←
        </button>
        <h1 className="text-lg font-semibold truncate flex-1">{playlist.name}</h1>
        <a
          href={playlist.external_urls.spotify}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1DB954] text-sm font-medium"
        >
          Open in Spotify ↗
        </a>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-28 flex flex-col gap-5">
        {/* Playlist info */}
        <div className="flex items-center gap-4">
          {playlist.images[0] ? (
            <img
              src={playlist.images[0].url}
              alt={playlist.name}
              className="w-20 h-20 rounded-lg object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-lg bg-[#282828] flex items-center justify-center text-[#535353]">
              <MusicIcon size={32} />
            </div>
          )}
          <div className="flex-1">
            <div className="text-[#B3B3B3] text-sm">{playlist.tracks.total} tracks</div>
          </div>
          {isAutoUpdate && (
            <button
              onClick={handleRefresh}
              disabled={updating}
              className="p-3 bg-[#1DB954] hover:bg-[#1ED760] text-black rounded-full disabled:opacity-50"
              title="Refresh playlist"
            >
              <RefreshIcon size={22} className={updating ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        {!isAutoUpdate && (
          <div className="bg-[#181818] rounded-xl p-4 text-[#B3B3B3] text-sm">
            This playlist is not managed by Brewtify (no auto-update settings found).
          </div>
        )}

        {isAutoUpdate && (
          <>
            {/* Settings section */}
            <div className="bg-[#181818] rounded-xl p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">Settings</span>
                {!editMode && (
                  <button
                    onClick={handleEnterEditMode}
                    className="text-xs text-[#1DB954] hover:text-[#1ED760]"
                  >
                    Edit
                  </button>
                )}
              </div>

              {/* Schedule */}
              <div>
                <label className="text-xs text-[#B3B3B3] mb-1.5 block">Auto-refresh schedule</label>
                {editMode ? (
                  <div className="flex gap-2">
                    {SCHEDULE_OPTIONS.map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => { setSettings({ ...settings, schedule: opt.value }); setDirty(true); }}
                        className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          settings.schedule === opt.value
                            ? 'bg-[#1DB954] text-black'
                            : 'bg-[#282828] text-[#B3B3B3] hover:bg-[#333333]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-white text-sm">
                    {settings.schedule === 'daily' ? 'Daily' : settings.schedule === 'weekly' ? 'Weekly' : 'Off'}
                  </span>
                )}
              </div>

              {/* Track count */}
              <div>
                <label className="text-xs text-[#B3B3B3] mb-1.5 block">Tracks</label>
                {editMode ? (
                  <div className="flex gap-2">
                    {TRACK_OPTIONS.map((n) => (
                      <button
                        key={n}
                        onClick={() => { setSettings({ ...settings, count: n }); setDirty(true); }}
                        className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          settings.count === n
                            ? 'bg-[#1DB954] text-black'
                            : 'bg-[#282828] text-[#B3B3B3] hover:bg-[#333333]'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-white text-sm">{settings.count}</span>
                )}
              </div>

              {/* Era preference */}
              <div>
                <label className="text-xs text-[#B3B3B3] mb-1.5 block">Era preference</label>
                {editMode ? (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={settings.era}
                      onChange={(e) => { setSettings({ ...settings, era: Number(e.target.value) }); setDirty(true); }}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[#535353] accent-[#1DB954]"
                    />
                    <div className="flex justify-between text-xs text-[#B3B3B3] mt-1">
                      <span>Older</span>
                      <span className={settings.era === 50 ? 'text-[#1DB954]' : ''}>Mixed</span>
                      <span>Newer</span>
                    </div>
                  </>
                ) : (
                  <span className="text-white text-sm">
                    {settings.era < 30 ? 'Older' : settings.era > 70 ? 'Newer' : 'Mixed'}
                  </span>
                )}
              </div>
            </div>

            {/* Artists section */}
            <div className="bg-[#181818] rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">
                  Artists ({artists.length})
                </span>
                {editMode && (
                  hasCustomWeights ? (
                    <button
                      onClick={() => { setSettings({ ...settings, weights: new Map() }); setDirty(true); }}
                      className="text-xs text-[#1DB954] hover:text-[#1ED760]"
                    >
                      Reset to equal
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const w = new Map<string, number>();
                        const equal = Math.round(100 / settings.artistIds.length);
                        settings.artistIds.forEach((id) => w.set(id, equal));
                        setSettings({ ...settings, weights: w });
                        setDirty(true);
                      }}
                      className="text-xs text-[#1DB954] hover:text-[#1ED760]"
                    >
                      Customize %
                    </button>
                  )
                )}
              </div>
              {editMode && hasCustomWeights && (
                <div className={`text-xs text-center ${isWeightValid ? 'text-[#1DB954]' : 'text-red-400'}`}>
                  Total: {totalWeight}%
                  {!isWeightValid && ' - Must equal 100%'}
                </div>
              )}

              {/* Current artists */}
              <div className="flex flex-col gap-2">
                {artists.map((artist) => (
                  <div
                    key={artist.id}
                    className="flex items-center gap-2 px-3 py-2 bg-[#282828] rounded-xl"
                  >
                    {artist.images?.[0] && (
                      <img
                        src={artist.images[0].url}
                        alt={artist.name}
                        className="w-6 h-6 rounded-full object-cover"
                      />
                    )}
                    <span className="text-xs text-white flex-1 truncate">{artist.name}</span>
                    {editMode && hasCustomWeights && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setWeight(artist.id, (settings.weights.get(artist.id) || 0) - 5)}
                          className="w-5 h-5 rounded-full bg-[#181818] text-[#B3B3B3] hover:bg-[#333333] text-xs flex items-center justify-center"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={settings.weights.get(artist.id) || Math.round(100 / settings.artistIds.length)}
                          onChange={(e) => setWeight(artist.id, Number(e.target.value) || 0)}
                          className="w-9 text-center text-xs text-[#1DB954] font-medium bg-transparent border-b border-[#535353] focus:border-[#1DB954] focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        <button
                          onClick={() => setWeight(artist.id, (settings.weights.get(artist.id) || 0) + 5)}
                          className="w-5 h-5 rounded-full bg-[#181818] text-[#B3B3B3] hover:bg-[#333333] text-xs flex items-center justify-center"
                        >
                          +
                        </button>
                      </div>
                    )}
                    {!editMode && (
                      <span className="text-xs text-[#535353]">
                        {displayPercentages.get(artist.id) || 0}%
                      </span>
                    )}
                    {editMode && !hasCustomWeights && (
                      <span className="text-xs text-[#535353]">
                        {displayPercentages.get(artist.id) || 0}%
                      </span>
                    )}
                    {editMode && (
                      <button
                        onClick={() => toggleArtist(artist)}
                        className="text-[#B3B3B3] hover:text-red-400 ml-1"
                      >
                        <MinusIcon size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add artists - search, filter & grid */}
              {editMode && (
                <div className="flex flex-col gap-3 mt-2 border-t border-[#282828] pt-3">
                  <span className="text-sm font-medium text-white">Your Followed Artists</span>

                  {/* Search + Filter row */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Search artists..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 p-2.5 bg-[#282828] border border-[#535353] rounded-xl text-white text-sm placeholder-[#535353] focus:outline-none focus:border-[#1DB954]"
                    />
                    <button
                      onClick={() => setFiltersOpen(!filtersOpen)}
                      className={`px-3 rounded-xl flex items-center gap-1 text-sm font-medium transition-colors ${
                        filtersOpen || selectedGenres.size > 0
                          ? 'bg-[#1DB954] text-black'
                          : 'bg-[#282828] text-[#B3B3B3] border border-[#535353] hover:bg-[#333333]'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                      {selectedGenres.size > 0 && (
                        <span className="bg-black text-[#1DB954] text-xs w-4 h-4 rounded-full flex items-center justify-center font-bold">
                          {selectedGenres.size}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Genre filter panel */}
                  {filtersOpen && sortedGenres.length > 0 && (
                    <div className="bg-[#282828] rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[#B3B3B3]">Genres</span>
                        {selectedGenres.size > 0 && (
                          <button
                            onClick={() => setSelectedGenres(new Set())}
                            className="text-xs text-[#1DB954] hover:text-[#1ED760]"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {sortedGenres.slice(0, 30).map((genre) => (
                          <button
                            key={genre}
                            onClick={() => toggleGenre(genre)}
                            className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                              selectedGenres.has(genre)
                                ? 'bg-[#1DB954] text-black'
                                : 'bg-[#181818] text-[#B3B3B3] hover:bg-[#333333]'
                            }`}
                          >
                            {genre}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {loadingAllArtists ? (
                    <div className="text-[#B3B3B3] text-xs text-center py-4">Loading artists...</div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto p-1">
                      {filteredAllArtists.slice(0, 40).map((artist) => {
                        const isSelected = settings.artistIds.includes(artist.id);
                        return (
                          <button
                            key={artist.id}
                            onClick={() => toggleArtist(artist)}
                            className={`relative flex flex-col items-center p-2 rounded-lg transition-all ${
                              isSelected
                                ? 'bg-[#1DB954]/20 ring-1 ring-[#1DB954]'
                                : 'bg-[#282828] hover:bg-[#333333]'
                            }`}
                          >
                            {artist.images[0] ? (
                              <img
                                src={artist.images[0].url}
                                alt={artist.name}
                                className="w-10 h-10 rounded-full object-cover mb-1"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-[#333333] mb-1 flex items-center justify-center text-[#B3B3B3]">
                                <MicIcon size={16} />
                              </div>
                            )}
                            <span className="text-[10px] text-center leading-tight line-clamp-2 text-white">
                              {artist.name}
                            </span>
                            {isSelected && (
                              <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-[#1DB954] rounded-full flex items-center justify-center">
                                <CheckIcon size={10} className="text-black" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Status */}
      {status && (
        <div className="fixed bottom-20 left-4 right-4 text-sm text-[#B3B3B3] text-center bg-[#282828] py-2 rounded-lg">
          {status}
        </div>
      )}

      {/* Bottom actions */}
      {editMode && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#121212] border-t border-[#282828] flex gap-2">
          <button
            onClick={() => { setEditMode(false); setDirty(false); loadPlaylist(); }}
            className="py-3 px-4 bg-[#282828] text-white font-medium rounded-full text-sm"
          >
            Cancel
          </button>
          {dirty && (
            <>
              <button
                onClick={handleSave}
                disabled={saving || updating || !isWeightValid}
                className="flex-1 py-3 bg-[#282828] border border-[#1DB954] text-[#1DB954] font-bold rounded-full text-sm disabled:opacity-50"
              >
                {saving && !updating ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleSaveAndRefresh}
                disabled={saving || updating || !isWeightValid}
                className="flex-1 py-3 bg-[#1DB954] hover:bg-[#1ED760] text-black font-bold rounded-full text-sm disabled:opacity-50"
              >
                {updating ? 'Refreshing...' : 'Save & Refresh'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
