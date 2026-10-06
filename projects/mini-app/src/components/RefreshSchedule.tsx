import { useState } from 'react';
import { WEEKDAYS, parseRefreshDays, serializeRefreshDays, formatRefreshSchedule } from '@brewtify/shared';

interface RefreshScheduleProps {
  schedule: string | null;
  onChange: (schedule: string | null) => void;
}

export function RefreshSchedule({ schedule, onChange }: RefreshScheduleProps) {
  const days = parseRefreshDays(schedule);
  const enabled = days.length > 0;
  // Remember selections only within this editor. Saving None does not persist hidden days.
  const [rememberedDays, setRememberedDays] = useState(() => days.length ? days : [new Date().getUTCDay()]);
  const [message, setMessage] = useState('');
  const shownDays = enabled ? days : rememberedDays;

  function toggleEnabled() {
    setMessage('');
    if (enabled) {
      setRememberedDays(days);
      onChange(null);
    } else onChange(serializeRefreshDays(rememberedDays));
  }

  function toggleDay(day: number) {
    if (days.includes(day) && days.length === 1) {
      setMessage('Use the switch to turn auto-refresh off.');
      return;
    }
    setMessage('');
    const next = days.includes(day) ? days.filter(value => value !== day) : [...days, day];
    setRememberedDays(next);
    onChange(serializeRefreshDays(next));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#B3B3B3]">Auto-refresh</span>
        <button
          type="button"
          role="switch"
          aria-label="Enable auto-refresh"
          aria-checked={enabled}
          onClick={toggleEnabled}
          className="flex items-center justify-center min-w-11 min-h-11 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1ED760]"
        >
          <span className={`w-11 h-6 p-0.5 rounded-full transition-colors ${enabled ? 'bg-[#1DB954]' : 'bg-[#454545]'}`}>
            <span className={`block w-5 h-5 rounded-full transition-transform ${enabled ? 'translate-x-5 bg-black' : 'bg-white'}`} />
          </span>
        </button>
      </div>
      <div role="group" aria-label="Refresh days" className={`grid grid-cols-7 gap-1 ${enabled ? '' : 'opacity-40'}`}>
        {WEEKDAYS.map((name, day) => (
          <button
            key={name}
            type="button"
            title={name}
            aria-label={name}
            aria-pressed={shownDays.includes(day)}
            disabled={!enabled}
            onClick={() => toggleDay(day)}
            className="min-h-11 flex items-center justify-center rounded-full text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1ED760] disabled:cursor-default"
          >
            <span className={`w-full max-w-11 aspect-square flex items-center justify-center rounded-full transition-colors ${shownDays.includes(day) ? 'bg-[#1DB954] text-black' : 'bg-[#282828] text-[#B3B3B3] hover:bg-[#333333]'}`}>
              {name[0]}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-[#B3B3B3] mt-3" aria-live="polite">{formatRefreshSchedule(schedule)}</p>
      <p className="text-xs text-[#B3B3B3] mt-1">{message || 'Turn off for manual refresh only.'}</p>
    </div>
  );
}
