import { NoteIcon, UserIcon } from './Icons';

type Tab = 'playlists' | 'artists';

interface BottomTabsProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export function BottomTabs({ activeTab, onTabChange }: BottomTabsProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#181818] border-t border-[#282828] z-20">
      <div className="flex">
        <button
          onClick={() => onTabChange('playlists')}
          className={`flex-1 flex flex-col items-center py-3 gap-1 transition-colors ${
            activeTab === 'playlists' ? 'text-white' : 'text-[#B3B3B3]'
          }`}
        >
          <NoteIcon size={22} className={activeTab === 'playlists' ? 'text-[#1DB954]' : ''} />
          <span className="text-[10px] font-medium">Playlists</span>
        </button>
        <button
          onClick={() => onTabChange('artists')}
          className={`flex-1 flex flex-col items-center py-3 gap-1 transition-colors ${
            activeTab === 'artists' ? 'text-white' : 'text-[#B3B3B3]'
          }`}
        >
          <UserIcon size={22} className={activeTab === 'artists' ? 'text-[#1DB954]' : ''} />
          <span className="text-[10px] font-medium">Artists</span>
        </button>
      </div>
    </nav>
  );
}
