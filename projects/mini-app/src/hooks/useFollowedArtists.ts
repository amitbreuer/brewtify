import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Artist } from '../lib/types';
import { fetchAllFollowedArtists } from '../lib/api';
import { filterArtists, getSortedGenres } from '../lib/utils';

interface UseFollowedArtistsReturn {
  artists: Artist[];
  filteredArtists: Artist[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedGenres: Set<string>;
  toggleGenre: (genre: string) => void;
  clearGenres: () => void;
  sortedGenres: string[];
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
}

export function useFollowedArtists(autoLoad = true): UseFollowedArtistsReturn {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    try {
      const all = await fetchAllFollowedArtists();
      setArtists(all);
    } catch (err: any) {
      console.error('Failed to load artists:', err);
      loadedRef.current = false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoLoad) {
      load();
    }
  }, [autoLoad, load]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      if (next.has(genre)) next.delete(genre);
      else next.add(genre);
      return next;
    });
  };

  const clearGenres = () => setSelectedGenres(new Set());

  const sortedGenres = useMemo(() => getSortedGenres(artists), [artists]);

  const filteredArtists = useMemo(
    () => filterArtists(artists, searchQuery, selectedGenres),
    [artists, searchQuery, selectedGenres]
  );

  return {
    artists,
    filteredArtists,
    loading,
    searchQuery,
    setSearchQuery,
    selectedGenres,
    toggleGenre,
    clearGenres,
    sortedGenres,
    filtersOpen,
    setFiltersOpen,
  };
}
