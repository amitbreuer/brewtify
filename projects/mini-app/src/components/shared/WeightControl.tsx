interface WeightControlProps {
  value: number | undefined;
  onChange: (value: number) => void;
  size?: 'sm' | 'md';
}

export function WeightControl({ value, onChange, size = 'md' }: WeightControlProps) {
  const btnClass = size === 'sm'
    ? 'w-5 h-5 rounded-full bg-[#181818] text-[#B3B3B3] hover:bg-[#333333] text-xs flex items-center justify-center'
    : 'w-6 h-6 rounded-full bg-[#282828] text-[#B3B3B3] hover:bg-[#333333] text-xs flex items-center justify-center';
  const inputWidth = size === 'sm' ? 'w-9' : 'w-10';

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange((value || 0) - 5)}
        className={btnClass}
      >
        −
      </button>
      <input
        type="number"
        min={0}
        max={100}
        value={value !== undefined ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className={`${inputWidth} text-center text-xs text-[#1DB954] font-medium bg-transparent border-b border-[#535353] focus:border-[#1DB954] focus:outline-none appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <button
        onClick={() => onChange((value || 0) + 5)}
        className={btnClass}
      >
        +
      </button>
    </div>
  );
}
