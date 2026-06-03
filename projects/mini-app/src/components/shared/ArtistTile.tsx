import type { Artist } from '../../lib/types';
import { MicIcon, CheckIcon } from '../Icons';

interface ArtistTileProps {
  artist: Artist;
  isSelected: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
}

export function ArtistTile({ artist, isSelected, onClick, size = 'md' }: ArtistTileProps) {
  const imgSize = size === 'sm' ? 'w-10 h-10' : 'w-16 h-16';
  const iconSize = size === 'sm' ? 16 : 20;
  const checkSize = size === 'sm' ? 10 : 12;
  const checkBadge = size === 'sm'
    ? 'w-4 h-4 top-0.5 right-0.5'
    : 'w-5 h-5 top-1 right-1';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  const padding = size === 'sm' ? 'p-2' : 'p-3';
  const rounded = size === 'sm' ? 'rounded-lg' : 'rounded-xl';
  const ring = size === 'sm' ? 'ring-1' : 'ring-2';

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center ${padding} ${rounded} transition-all ${
        isSelected
          ? `bg-[#1DB954]/20 ${ring} ring-[#1DB954]`
          : `bg-[#181818] hover:bg-[#282828]`
      }`}
    >
      {artist.images?.[0] ? (
        <img
          src={artist.images[0].url}
          alt={artist.name}
          className={`${imgSize} rounded-full object-cover mb-${size === 'sm' ? '1' : '2'}`}
        />
      ) : (
        <div className={`${imgSize} rounded-full bg-[#282828] mb-${size === 'sm' ? '1' : '2'} flex items-center justify-center text-[#B3B3B3]`}>
          <MicIcon size={iconSize} />
        </div>
      )}
      <span className={`${textSize} text-center leading-tight line-clamp-2 text-white`}>
        {artist.name}
      </span>
      {isSelected && (
        <div className={`absolute ${checkBadge} bg-[#1DB954] rounded-full flex items-center justify-center`}>
          <CheckIcon size={checkSize} className="text-black" />
        </div>
      )}
    </button>
  );
}
