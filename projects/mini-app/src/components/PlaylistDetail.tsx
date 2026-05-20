import { useState, useEffect, useCallback } from 'react';
import type { Playlist, Artist } from '../lib/types';
import {
  fetchPlaylist,
  fetchArtistsByIds,
  fetchFollowedArtists,
  updatePlaylist,
  updatePlaylistDescription,
} from '../lib/api';
import { MusicIcon, MicIcon, MinusIcon, CheckIcon } from './Icons';

interface PlaylistDetailProps {
  playlistId: string;
  onBack: () => void;
}

interface PlaylistSettings {
  artistIds: string[];
  weights: Map<string, number>;
  era: number;
  count: number;
  disabled: boolean;
}

function parseSettings(description: string): PlaylistSettings {
  const match = description.match(/\[Auto-update:\s*([^\]]+)\]/);
  if (!match) return { artistIds: [], weights: new Map(), era: 50, count: 100, disabled: false };

  const parts = match[1].split('|');
  const artistParts = parts[0].split(',').map((s) => s.trim()).filter(Boolean);

  const artistIds: string[] = [];
  const weights = new Map<string, number>();
  let hasWeights = false;

  for (const part of artistParts) {
    const [id, weightStr] = part.split(':');
    artistIds.push(id.trim());
    if (weightStr) {
      weights.set(id.trim(), parseInt(weightStr) || 0);
      hasWeights = true;
    }
  }

  // If no explicit weights, leave the map empty (means equal distribution)
  if (!hasWeights) weights.clear();

  let era = 50;
  let count = 100;
  let disabled = false;

  for (const part of parts.slice(1)) {
    if (part.trim() === 'disabled') {
      disabled = true;
      continue;
    }
    const [key, val] = part.split('=');
    if (key === 'era') era = parseInt(val) || 50;
    if (key === 'count') count = parseInt(val) || 100;
  }

  return { artistIds, weights, era, count, disabled };
}

function encodeSettings(settings: PlaylistSettings): string {
  let artistsEncoded: string;
  if (settings.weights.size > 0) {
    // Normalize weights before encoding
    const totalWeight = Array.from(settings.weights.values()).reduce((s, w) => s + w, 0) || 1;
    artistsEncoded = settings.artistIds.map((id) => {
      const w = settings.weights.get(id) || 0;
      const pct = Math.round((w / totalWeight) * 100);
      return `${id}:${pct}`;
    }).join(',');
  } else {
    artistsEncoded = settings.artistIds.join(',');
  }
  let desc = `[Auto-update: ${artistsEncoded}`;
  if (settings.era !== 50) desc += `|era=${settings.era}`;
  if (settings.count !== 100) desc += `|count=${settings.count}`;
  if (settings.disabled) desc += `|disabled`;
  desc += ']';
  return desc;
}

const TRACK_OPTIONS = [60, 80, 100, 120, 140];

export function PlaylistDetail({ playlistId, onBack }: PlaylistDetailProps) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [settings, setSettings] = useState<PlaylistSettings>({ artistIds: [], weights: new Map(), era: 50, count: 100, disabled: false });
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [allArtists, setAllArtists] = useState<Artist[]>([]);
  const [loadingAllArtists, setLoadingAllArtists] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dirty, setDirty] = useState(false);

  const loadPlaylist = useCallback(async () => {
    setLoading(true);
    try {
      const pl = await fetchPlaylist(playlistId);
      setPlaylist(pl);
      const parsed = parseSettings(pl.description || '');
      setSettings(parsed);

      if (parsed.artistIds.length > 0) {
        const artistData = await fetchArtistsByIds(parsed.artistIds);
        setArtists(artistData);
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
    newWeights.set(artistId, Math.max(0, Math.min(100, weight)));
    setSettings({ ...settings, weights: newWeights });
    setDirty(true);
  };

  const hasCustomWeights = settings.weights.size > 0;

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
      const description = encodeSettings(settings);
      await updatePlaylistDescription(playlistId, description);
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
      const description = encodeSettings(settings);
      await updatePlaylistDescription(playlistId, description);
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

  const filteredAllArtists = allArtists.filter((a) => {
    if (!searchQuery) return true;
    return a.name.toLowerCase().includes(searchQuery.toLowerCase());
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
          <div>
            <div className="text-[#B3B3B3] text-sm">{playlist.tracks.total} tracks</div>
          </div>
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

              {/* Auto-refresh toggle */}
              <div className="flex items-center justify-between">
                <label className="text-xs text-[#B3B3B3]">Auto-refresh</label>
                <button
                  onClick={async () => {
                    const newSettings = { ...settings, disabled: !settings.disabled };
                    setSettings(newSettings);
                    // Save immediately (no need for edit mode)
                    try {
                      const desc = encodeSettings(newSettings);
                      await updatePlaylistDescription(playlistId, desc);
                      setStatus('');
                    } catch (err: any) {
                      setSettings(settings); // revert
                      setStatus(`❌ ${err.message}`);
                    }
                  }}
                  className={`relative inline-flex items-center w-10 h-[22px] rounded-full transition-colors shrink-0 ${
                    !settings.disabled ? 'bg-[#1DB954]' : 'bg-[#535353]'
                  }`}
                >
                  <span
                    className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      !settings.disabled ? 'translate-x-[22px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
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
                        <span className="text-xs text-[#1DB954] w-7 text-center font-medium">
                          {displayPercentages.get(artist.id) || 0}%
                        </span>
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

              {/* Add artists - search & grid */}
              {editMode && (
                <div className="flex flex-col gap-3 mt-2 border-t border-[#282828] pt-3">
                  <input
                    type="text"
                    placeholder="Search artists to add..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full p-2.5 bg-[#282828] border border-[#535353] rounded-xl text-white text-sm placeholder-[#535353] focus:outline-none focus:border-[#1DB954]"
                  />
                  {loadingAllArtists ? (
                    <div className="text-[#B3B3B3] text-xs text-center py-4">Loading artists...</div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto">
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
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#121212] border-t border-[#282828] flex gap-2">
        {editMode ? (
          <>
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
                  disabled={saving || updating}
                  className="flex-1 py-3 bg-[#282828] border border-[#1DB954] text-[#1DB954] font-bold rounded-full text-sm disabled:opacity-50"
                >
                  {saving && !updating ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleSaveAndRefresh}
                  disabled={saving || updating}
                  className="flex-1 py-3 bg-[#1DB954] hover:bg-[#1ED760] text-black font-bold rounded-full text-sm disabled:opacity-50"
                >
                  {updating ? 'Refreshing...' : 'Save & Refresh'}
                </button>
              </>
            )}
          </>
        ) : (
          isAutoUpdate && (
            <button
              onClick={handleRefresh}
              disabled={updating}
              className="w-full py-3 bg-[#1DB954] hover:bg-[#1ED760] text-black font-bold rounded-full disabled:opacity-50"
            >
              {updating ? 'Refreshing...' : 'Refresh Playlist'}
            </button>
          )
        )}
      </div>
    </div>
  );
}
