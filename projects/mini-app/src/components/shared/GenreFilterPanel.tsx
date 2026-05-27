interface GenreFilterPanelProps {
  genres: string[];
  selectedGenres: Set<string>;
  onToggle: (genre: string) => void;
  onClear: () => void;
  maxGenres?: number;
  size?: 'sm' | 'md';
}

export function GenreFilterPanel({
  genres,
  selectedGenres,
  onToggle,
  onClear,
  maxGenres = 40,
  size = 'md',
}: GenreFilterPanelProps) {
  const containerClass = size === 'sm'
    ? 'bg-[#282828] rounded-xl p-3 flex flex-col gap-2'
    : 'bg-[#181818] rounded-xl p-4 flex flex-col gap-3 border border-[#282828]';
  const headerTextClass = size === 'sm' ? 'text-xs' : 'text-sm';
  const pillClass = size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1.5 text-xs';
  const gapClass = size === 'sm' ? 'gap-1.5' : 'gap-2';
  const clearLabel = size === 'sm' ? 'Clear' : 'Clear all';

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between">
        <span className={`${headerTextClass} font-medium text-[#B3B3B3]`}>Genres</span>
        {selectedGenres.size > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-[#1DB954] hover:text-[#1ED760]"
          >
            {clearLabel}
          </button>
        )}
      </div>
      <div className={`flex flex-wrap ${gapClass}`}>
        {genres.slice(0, maxGenres).map((genre) => (
          <button
            key={genre}
            onClick={() => onToggle(genre)}
            className={`${pillClass} rounded-full font-medium transition-colors ${
              selectedGenres.has(genre)
                ? 'bg-[#1DB954] text-black'
                : size === 'sm'
                  ? 'bg-[#181818] text-[#B3B3B3] hover:bg-[#333333]'
                  : 'bg-[#282828] text-[#B3B3B3] hover:bg-[#333333]'
            }`}
          >
            {genre}
          </button>
        ))}
      </div>
    </div>
  );
}
