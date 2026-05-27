import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  onBack: () => void;
  rightContent?: ReactNode;
}

export function PageHeader({ title, onBack, rightContent }: PageHeaderProps) {
  return (
    <header className="sticky top-0 bg-[#121212] border-b border-[#282828] z-10 p-4 flex items-center gap-3">
      <button onClick={onBack} className="text-[#B3B3B3] hover:text-white text-xl">
        ←
      </button>
      <h1 className="text-lg font-semibold truncate flex-1">{title}</h1>
      {rightContent}
    </header>
  );
}
