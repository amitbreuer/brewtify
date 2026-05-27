import type { Artist } from './types';

export function filterArtists(
  artists: Artist[],
  searchQuery: string,
  selectedGenres: Set<string>
): Artist[] {
  return artists.filter((a) => {
    const matchesSearch = !searchQuery ||
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.genres.some((g) => g.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesGenre = selectedGenres.size === 0 ||
      a.genres.some((g) => selectedGenres.has(g));

    return matchesSearch && matchesGenre;
  });
}

export function getSortedGenres(artists: Artist[]): string[] {
  const genreCounts = artists.reduce((acc, a) => {
    a.genres.forEach((g) => acc.set(g, (acc.get(g) || 0) + 1));
    return acc;
  }, new Map<string, number>());

  return Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);
}
