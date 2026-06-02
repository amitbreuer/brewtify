import { useState, useEffect, useCallback } from 'react';
import type { Playlist, Artist } from '../lib/types';
import {
  fetchPlaylist,
  fetchArtistsByIds,
  updatePlaylist,
  fetchPlaylistSettings,
  updatePlaylistSettings,
  renamePlaylist,
} from '../lib/api';
import { MusicIcon, MinusIcon, RefreshIcon, CheckIcon, CloseIcon, PencilIcon } from './Icons';
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
  StatusBar,
  LoadingState,
  ErrorState,
} from './shared';

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
  lastUpdatedAt: string | null;
  nextUpdateAt: string | null;
}

function formatScheduleDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (diffMs < 0) {
    // Past
    if (diffHours > -24) return `${Math.abs(diffHours)}h ago`;
    return `${Math.abs(diffDays)}d ago`;
  }
  // Future
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays <= 7) return `in ${diffDays}d`;
  return dateStr;
}

export function PlaylistDetail({ playlistId, onBack }: PlaylistDetailProps) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [settings, setSettings] = useState<PlaylistSettings>({ artistIds: [], weights: new Map(), era: 50, count: 100, schedule: null, lastUpdatedAt: null, nextUpdateAt: null });
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const {
    filteredArtists: filteredAllArtists,
    loading: loadingAllArtists,
    searchQuery,
    setSearchQuery,
    selectedGenres,
    toggleGenre,
    clearGenres,
    sortedGenres,
    filtersOpen,
    setFiltersOpen,
  } = useFollowedArtists(!editMode ? false : true);

  const {
    weights: weightMap,
    hasCustomWeights,
    totalWeight,
    isWeightValid,
    displayPercentages,
    setWeight: setWeightHook,
    setWeights,
    enableCustomWeights: enableCustomWeightsHook,
    resetToEqual: resetToEqualHook,
    removeArtist,
  } = useArtistWeights({ artistIds: settings.artistIds });

  // Sync weights from loaded settings into the hook
  const syncWeightsFromSettings = useCallback((weights: Map<string, number>) => {
    setWeights(weights);
  }, [setWeights]);

  const setWeight = (artistId: string, weight: number) => {
    setWeightHook(artistId, weight);
    setDirty(true);
  };

  const enableCustomWeights = () => {
    enableCustomWeightsHook();
    setDirty(true);
  };

  const resetToEqual = () => {
    resetToEqualHook();
    setDirty(true);
  };

  const loadPlaylist = useCallback(async () => {
    setLoading(true);
    try {
      const pl = await fetchPlaylist(playlistId);
      setPlaylist(pl);

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
          lastUpdatedAt: dbSettings.lastUpdatedAt ?? null,
          nextUpdateAt: dbSettings.nextUpdateAt ?? null,
        };
        setSettings(parsed);
        syncWeightsFromSettings(weights);

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
  }, [playlistId, syncWeightsFromSettings]);

  useEffect(() => {
    loadPlaylist();
  }, [loadPlaylist]);

  const toggleArtist = (artist: Artist) => {
    const isSelected = settings.artistIds.includes(artist.id);
    let newIds: string[];
    let newArtists: Artist[];

    if (isSelected) {
      newIds = settings.artistIds.filter((id) => id !== artist.id);
      newArtists = artists.filter((a) => a.id !== artist.id);
      removeArtist(artist.id);
    } else {
      newIds = [...settings.artistIds, artist.id];
      newArtists = [...artists, artist];
    }

    setSettings({ ...settings, artistIds: newIds });
    setArtists(newArtists);
    setDirty(true);
  };

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
      const weightsObj = weightMap.size > 0
        ? Object.fromEntries(weightMap)
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
      const weightsObj = weightMap.size > 0
        ? Object.fromEntries(weightMap)
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

  const handleRename = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || !playlist || trimmed === playlist.name) {
      setEditingName(false);
      return;
    }
    try {
      await renamePlaylist(playlistId, trimmed);
      setPlaylist({ ...playlist, name: trimmed });
      setEditingName(false);
      setStatus('✅ Playlist renamed!');
    } catch (err: any) {
      setStatus(`❌ ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#121212] text-white flex items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="min-h-screen bg-[#121212] text-white flex items-center justify-center">
        <ErrorState message="Playlist not found" />
      </div>
    );
  }

  const isAutoUpdate = settings.artistIds.length > 0;

  return (
    <div className="min-h-screen bg-[#121212] text-white flex flex-col">
      <PageHeader
        title={
          editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditingName(false); }}
                className="bg-[#282828] text-white text-sm font-semibold px-2 py-1 rounded border border-[#535353] focus:border-[#1DB954] outline-none w-40"
                autoFocus
                maxLength={100}
              />
              <button onClick={handleRename} className="text-[#1DB954]"><CheckIcon size={18} /></button>
              <button onClick={() => setEditingName(false)} className="text-[#B3B3B3]"><CloseIcon size={18} /></button>
            </div>
          ) : (
            <span onClick={() => { setNameInput(playlist.name); setEditingName(true); }} className="cursor-pointer flex items-center gap-1.5">
              {playlist.name}
              <PencilIcon size={16} className="text-[#B3B3B3] shrink-0" />
            </span>
          )
        }
        onBack={onBack}
        rightContent={
          !editingName ? (
            <a
              href={playlist.external_urls.spotify}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1DB954] text-sm font-medium whitespace-nowrap"
            >
              Open in Spotify ↗
            </a>
          ) : undefined
        }
      />

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
            {/* Schedule info */}
            {settings.schedule && (settings.lastUpdatedAt || settings.nextUpdateAt) && (
              <div className="bg-[#181818] rounded-xl p-4 flex flex-col gap-2">
                {settings.lastUpdatedAt && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-[#B3B3B3]">Last updated</span>
                    <span className="text-xs text-white">{formatScheduleDate(settings.lastUpdatedAt)}</span>
                  </div>
                )}
                {settings.nextUpdateAt && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-[#B3B3B3]">Next update</span>
                    <span className="text-xs text-white">{formatScheduleDate(settings.nextUpdateAt)}</span>
                  </div>
                )}
              </div>
            )}
            {/* Settings section */}
            <div className="bg-[#181818] rounded-xl p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">Settings</span>
                {!editMode && (
                  <button
                    onClick={() => setEditMode(true)}
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
                      onClick={resetToEqual}
                      className="text-xs text-[#1DB954] hover:text-[#1ED760]"
                    >
                      Reset to equal
                    </button>
                  ) : (
                    <button
                      onClick={enableCustomWeights}
                      className="text-xs text-[#1DB954] hover:text-[#1ED760]"
                    >
                      Customize %
                    </button>
                  )
                )}
              </div>
              {editMode && hasCustomWeights && (
                <WeightValidation totalWeight={totalWeight} isValid={isWeightValid} />
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
                      <WeightControl
                        value={weightMap.get(artist.id)}
                        onChange={(v) => setWeight(artist.id, v)}
                        size="sm"
                      />
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

              {/* Add artists */}
              {editMode && (
                <div className="flex flex-col gap-3 mt-2 border-t border-[#282828] pt-3">
                  <span className="text-sm font-medium text-white">Your Followed Artists</span>

                  <ArtistSearchBar
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    filtersOpen={filtersOpen}
                    onToggleFilters={() => setFiltersOpen(!filtersOpen)}
                    selectedGenreCount={selectedGenres.size}
                    size="sm"
                  />

                  {filtersOpen && sortedGenres.length > 0 && (
                    <GenreFilterPanel
                      genres={sortedGenres}
                      selectedGenres={selectedGenres}
                      onToggle={toggleGenre}
                      onClear={clearGenres}
                      maxGenres={30}
                      size="sm"
                    />
                  )}

                  {loadingAllArtists ? (
                    <div className="text-[#B3B3B3] text-xs text-center py-4">Loading artists...</div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto p-1">
                      {filteredAllArtists.slice(0, 40).map((artist) => (
                        <ArtistTile
                          key={artist.id}
                          artist={artist}
                          isSelected={settings.artistIds.includes(artist.id)}
                          onClick={() => toggleArtist(artist)}
                          size="sm"
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <StatusBar message={status} />

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
