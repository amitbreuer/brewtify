import { useState, useEffect, useCallback, useRef } from 'react';
import type { Artist } from '../lib/types';
import {
  searchArtists,
  fetchAllFollowedArtists,
  fetchSuggestedArtists,
  followArtist,
  unfollowArtist,
  checkFollowingArtists,
} from '../lib/api';
import { MicIcon, SearchIcon, RefreshIcon } from './Icons';
import { ArtistListSkeleton } from './shared';

export function ArtistsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Artist[]>([]);
  const [searching, setSearching] = useState(false);
  const [followedArtists, setFollowedArtists] = useState<Artist[]>([]);
  const [loadingFollowed, setLoadingFollowed] = useState(true);
  const [suggestedArtists, setSuggestedArtists] = useState<Artist[]>([]);
  const [loadingSuggested, setLoadingSuggested] = useState(true);
  const [followingState, setFollowingState] = useState<Map<string, boolean>>(new Map());
  const [togglingFollow, setTogglingFollow] = useState<Set<string>>(new Set());
  const [followedGenreFilter, setFollowedGenreFilter] = useState('All genres');
  const [suggestedGenreFilter, setSuggestedGenreFilter] = useState('All genres');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load followed artists
  useEffect(() => {
    fetchAllFollowedArtists()
      .then((artists) => {
        setFollowedArtists(artists);
        const followMap = new Map<string, boolean>();
        artists.forEach((a) => followMap.set(a.id, true));
        setFollowingState(followMap);
      })
      .catch(console.error)
      .finally(() => setLoadingFollowed(false));
  }, []);

  // Load suggested artists after followed artists are loaded
  useEffect(() => {
    if (loadingFollowed) return;
    fetchSuggestedArtists()
      .then((data) => setSuggestedArtists(data.items))
      .catch(console.error)
      .finally(() => setLoadingSuggested(false));
  }, [loadingFollowed]);

  // Debounced search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchArtists(value.trim(), 20);
        setSearchResults(data.items);
        // Check following status for search results
        const unknownIds = data.items
          .map((a) => a.id)
          .filter((id) => !followingState.has(id));
        if (unknownIds.length > 0) {
          const statuses = await checkFollowingArtists(unknownIds);
          setFollowingState((prev) => {
            const next = new Map(prev);
            statuses.forEach((s) => next.set(s.id, s.following));
            return next;
          });
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [followingState]);

  // Check following for suggested artists
  useEffect(() => {
    if (suggestedArtists.length === 0) return;
    const unknownIds = suggestedArtists
      .map((a) => a.id)
      .filter((id) => !followingState.has(id));
    if (unknownIds.length > 0) {
      checkFollowingArtists(unknownIds)
        .then((statuses) => {
          setFollowingState((prev) => {
            const next = new Map(prev);
            statuses.forEach((s) => next.set(s.id, s.following));
            return next;
          });
        })
        .catch(console.error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedArtists]);

  const handleRefreshSuggested = async () => {
    setLoadingSuggested(true);
    try {
      const genre = suggestedGenreFilter === 'All genres' ? undefined : suggestedGenreFilter;
      const data = await fetchSuggestedArtists(genre);
      setSuggestedArtists(data.items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSuggested(false);
    }
  };

  const handleSuggestedGenreChange = async (genre: string) => {
    setSuggestedGenreFilter(genre);
    setLoadingSuggested(true);
    try {
      const genreParam = genre === 'All genres' ? undefined : genre;
      const data = await fetchSuggestedArtists(genreParam);
      setSuggestedArtists(data.items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSuggested(false);
    }
  };

  const handleToggleFollow = async (artistId: string) => {
    if (togglingFollow.has(artistId)) return;
    setTogglingFollow((prev) => new Set(prev).add(artistId));

    const isFollowing = followingState.get(artistId) ?? false;
    try {
      if (isFollowing) {
        await unfollowArtist(artistId);
        setFollowingState((prev) => {
          const next = new Map(prev);
          next.set(artistId, false);
          return next;
        });
        setFollowedArtists((prev) => prev.filter((a) => a.id !== artistId));
      } else {
        await followArtist(artistId);
        setFollowingState((prev) => {
          const next = new Map(prev);
          next.set(artistId, true);
          return next;
        });
        // Add the artist to followed list if we have it in search results or suggestions
        const artist = [...searchResults, ...suggestedArtists].find((a) => a.id === artistId);
        if (artist) {
          setFollowedArtists((prev) => [artist, ...prev]);
        }
      }
    } catch (err) {
      console.error('Failed to toggle follow:', err);
    } finally {
      setTogglingFollow((prev) => {
        const next = new Set(prev);
        next.delete(artistId);
        return next;
      });
    }
  };

  const showSearchResults = searchQuery.trim().length > 0;

  // Compute genres from followed artists (used by both filters)
  const followedGenres = Array.from(
    new Set(followedArtists.flatMap((a) => a.genres || []))
  ).sort();

  // Filter followed artists by selected genre
  const filteredFollowed = followedGenreFilter === 'All genres'
    ? followedArtists
    : followedArtists.filter((a) => a.genres?.includes(followedGenreFilter));

  return (
    <div className="bg-[#121212] text-white pb-6 overflow-y-hidden">
      {/* Search Bar */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B3B3B3]" />
          <input
            type="text"
            placeholder="Search for artists on Spotify..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-[#282828] border border-[#535353] rounded-xl text-white text-sm placeholder-[#535353] focus:outline-none focus:border-[#1DB954]"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B3B3B3] hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <main className="py-1 space-y-3">
        {/* Search Results */}
        {showSearchResults && (
          <section className="px-4">
            <h2 className="text-lg font-bold mb-3">Search Results</h2>
            {searching ? (
              <ArtistListSkeleton count={4} />
            ) : searchResults.length === 0 ? (
              <p className="text-[#B3B3B3] text-sm">No artists found.</p>
            ) : (
              <div className="space-y-2">
                {searchResults.map((artist) => (
                  <ArtistRow
                    key={artist.id}
                    artist={artist}
                    isFollowing={followingState.get(artist.id) ?? false}
                    isToggling={togglingFollow.has(artist.id)}
                    onToggleFollow={() => handleToggleFollow(artist.id)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Followed Artists */}
        {!showSearchResults && (
          <>
            <section>
              <div className="flex items-center justify-between px-4">
                <h2 className="text-base font-bold">
                  Your Artists
                  {!loadingFollowed && (
                    <span className="text-sm font-normal text-[#B3B3B3] ml-2">
                      ({followedArtists.length})
                    </span>
                  )}
                </h2>
              </div>
              {!loadingFollowed && followedArtists.length > 0 && (
                <GenreChips
                  value={followedGenreFilter}
                  genres={followedGenres}
                  onChange={setFollowedGenreFilter}
                />
              )}
              {loadingFollowed ? (
                <HorizontalSkeleton />
              ) : followedArtists.length === 0 ? (
                <p className="text-[#B3B3B3] text-sm px-4">
                  You're not following any artists yet. Use the search above to find artists to follow.
                </p>
              ) : (
                <div className="flex gap-3 overflow-x-auto px-4 scrollbar-hide">
                  {filteredFollowed.map((artist) => (
                    <ArtistCard
                      key={artist.id}
                      artist={artist}
                      isFollowing={true}
                      isToggling={togglingFollow.has(artist.id)}
                      onToggleFollow={() => handleToggleFollow(artist.id)}
                      showGenreLabels
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Suggested Artists */}
            <section>
              <div className="flex items-center justify-between px-4">
                <h2 className="text-base font-bold">Suggested Artists</h2>
                <button
                  onClick={handleRefreshSuggested}
                  disabled={loadingSuggested}
                  className={`p-1.5 rounded-full text-[#B3B3B3] hover:text-white transition-colors ${loadingSuggested ? 'opacity-50 animate-spin' : ''}`}
                  aria-label="Refresh suggestions"
                >
                  <RefreshIcon size={18} />
                </button>
              </div>
              <GenreChips
                value={suggestedGenreFilter}
                genres={followedGenres}
                onChange={handleSuggestedGenreChange}
              />
              {loadingSuggested ? (
                <HorizontalSkeleton />
              ) : suggestedArtists.length === 0 ? (
                <p className="text-[#B3B3B3] text-sm px-4">
                  {followedArtists.length === 0
                    ? 'Follow more artists to get personalized suggestions.'
                    : 'No new suggestions found. Try following more artists to expand your recommendations.'}
                </p>
              ) : (
                <div className="flex gap-3 overflow-x-auto px-4 scrollbar-hide">
                  {suggestedArtists.map((artist) => (
                    <ArtistCard
                      key={artist.id}
                      artist={artist}
                      isFollowing={followingState.get(artist.id) ?? false}
                      isToggling={togglingFollow.has(artist.id)}
                      onToggleFollow={() => handleToggleFollow(artist.id)}
                      showGenreLabels
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// --- Sub-components ---

interface ArtistRowProps {
  artist: Artist;
  isFollowing: boolean;
  isToggling: boolean;
  onToggleFollow: () => void;
}

function ArtistRow({ artist, isFollowing, isToggling, onToggleFollow }: ArtistRowProps) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#1A1A1A] transition-colors">
      {artist.images?.[0] ? (
        <img
          src={artist.images[artist.images.length > 1 ? 1 : 0]?.url || artist.images[0].url}
          alt={artist.name}
          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-[#282828] flex items-center justify-center flex-shrink-0">
          <MicIcon size={20} className="text-[#B3B3B3]" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium text-sm truncate">{artist.name}</p>
        {artist.genres && artist.genres.length > 0 && (
          <p className="text-[#B3B3B3] text-xs truncate">
            {artist.genres.slice(0, 2).join(', ')}
          </p>
        )}
      </div>
      <button
        onClick={onToggleFollow}
        disabled={isToggling}
        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors flex-shrink-0 ${
          isFollowing
            ? 'border border-[#535353] text-white hover:border-white'
            : 'bg-white text-black hover:bg-[#E8E8E8]'
        } ${isToggling ? 'opacity-50' : ''}`}
      >
        {isToggling ? '...' : isFollowing ? 'Following' : 'Follow'}
      </button>
      <a
        href={artist.external_urls?.spotify}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 text-[#1DB954] hover:text-[#1ED760]"
        onClick={(e) => e.stopPropagation()}
      >
        <SpotifyIcon size={20} />
      </a>
    </div>
  );
}

interface ArtistCardProps {
  artist: Artist;
  isFollowing: boolean;
  isToggling: boolean;
  onToggleFollow: () => void;
  showGenreLabels?: boolean;
}

function ArtistCard({ artist, isFollowing, isToggling, onToggleFollow, showGenreLabels = false }: ArtistCardProps) {
  return (
    <div className="flex flex-col items-center w-32 flex-shrink-0 bg-[#181818] rounded-xl p-3 gap-2 h-full">
      {artist.images?.[0] ? (
        <img
          src={artist.images[artist.images.length > 1 ? 1 : 0]?.url || artist.images[0].url}
          alt={artist.name}
          className="w-16 h-16 rounded-full object-cover"
        />
      ) : (
        <div className="w-16 h-16 rounded-full bg-[#282828] flex items-center justify-center">
          <MicIcon size={24} className="text-[#B3B3B3]" />
        </div>
      )}
      <p className="text-white text-xs font-medium text-center leading-tight line-clamp-2 w-full h-[30px]">
        {artist.name}
      </p>
      <div className="flex flex-wrap justify-center gap-1 h-[30px] content-start mb-1">
        {showGenreLabels && (artist.matchedGenre ? (
          <span className="px-1.5 py-0.5 bg-[#282828] text-[#B3B3B3] text-[9px] rounded-full">
            {artist.matchedGenre}
          </span>
        ) : (
          artist.genres?.slice(0, artist.name.length > 15 ? 1 : 2).map((genre) => (
            <span
              key={genre}
              className="px-1.5 py-0.5 bg-[#282828] text-[#B3B3B3] text-[9px] rounded-full"
            >
              {genre}
            </span>
          ))
        ))}
      </div>
      <div className="mt-auto flex flex-col items-center gap-2 w-full">
        <button
          onClick={onToggleFollow}
          disabled={isToggling}
          className={`w-full px-2 py-1 rounded-full text-[10px] font-semibold transition-colors ${
            isFollowing
              ? 'border border-[#535353] text-white hover:border-white'
              : 'bg-white text-black hover:bg-[#E8E8E8]'
          } ${isToggling ? 'opacity-50' : ''}`}
        >
          {isToggling ? '...' : isFollowing ? 'Following' : 'Follow'}
        </button>
        <a
          href={artist.external_urls?.spotify}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1DB954] hover:text-[#1ED760]"
        >
          <SpotifyIcon size={16} />
        </a>
      </div>
    </div>
  );
}

function HorizontalSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden px-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center w-32 flex-shrink-0 bg-[#181818] rounded-xl p-3 gap-2">
          <div className="w-16 h-16 rounded-full bg-[#282828] animate-pulse" />
          <div className="h-[30px] w-16 bg-[#282828] rounded animate-pulse" />
          <div className="h-[30px] w-full bg-[#282828] rounded animate-pulse" />
          <div className="h-6 w-full bg-[#282828] rounded-full animate-pulse mt-auto" />
          <div className="w-5 h-5 bg-[#282828] rounded-full animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function SpotifyIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

interface GenreChipsProps {
  value: string;
  genres: string[];
  onChange: (genre: string) => void;
}

function GenreChips({ value, genres, onChange }: GenreChipsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-2.5 scrollbar-hide">
      {['All genres', ...genres].map((genre) => (
        <button
          key={genre}
          onClick={() => onChange(value === genre && genre !== 'All genres' ? 'All genres' : genre)}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors shrink-0 ${
            value === genre
              ? 'bg-[#1DB954] text-black'
              : 'bg-[#282828] text-[#B3B3B3] hover:text-white border border-[#535353]'
          }`}
        >
          {genre}
        </button>
      ))}
    </div>
  );
}
