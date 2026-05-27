interface ArtistSearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  selectedGenreCount: number;
  size?: 'sm' | 'md';
}

export function ArtistSearchBar({
  searchQuery,
  onSearchChange,
  filtersOpen,
  onToggleFilters,
  selectedGenreCount,
  size = 'md',
}: ArtistSearchBarProps) {
  const inputPadding = size === 'sm' ? 'p-2.5 text-sm' : 'p-3';
  const buttonPadding = size === 'sm' ? 'px-3' : 'px-4';
  const badgeSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <div className="flex gap-2">
      <input
        type="text"
        placeholder="Search artists..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className={`flex-1 ${inputPadding} bg-[#282828] border border-[#535353] rounded-xl text-white placeholder-[#535353] focus:outline-none focus:border-[#1DB954]`}
      />
      <button
        onClick={onToggleFilters}
        className={`${buttonPadding} rounded-xl flex items-center gap-1.5 text-sm font-medium transition-colors ${
          filtersOpen || selectedGenreCount > 0
            ? 'bg-[#1DB954] text-black'
            : 'bg-[#282828] text-[#B3B3B3] border border-[#535353] hover:bg-[#333333]'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        {selectedGenreCount > 0 && (
          <span className={`bg-black text-[#1DB954] text-xs ${badgeSize} rounded-full flex items-center justify-center font-bold`}>
            {selectedGenreCount}
          </span>
        )}
      </button>
    </div>
  );
}
