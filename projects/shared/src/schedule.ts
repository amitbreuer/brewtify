export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function serializeRefreshDays(days: readonly number[]): string | null {
  if (days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('Refresh days must be integers from 0 (Sunday) to 6 (Saturday)');
  }
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length ? `days:${unique.join(',')}` : null;
}

/** Reference anchors legacy interval-based weekly schedules to their existing due day. */
export function parseRefreshDays(schedule: unknown, reference = new Date()): number[] {
  if (schedule === null) return [];
  if (schedule === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (schedule === 'weekly') {
    if (!Number.isFinite(reference.getTime())) throw new Error('Invalid schedule reference date');
    return [reference.getUTCDay()];
  }
  if (typeof schedule === 'string' && /^weekly:[0-6]$/.test(schedule)) {
    return [Number(schedule.slice(7))];
  }
  if (typeof schedule !== 'string' || !/^days:[0-6](,[0-6])*$/.test(schedule)) {
    throw new Error('Schedule must be null, daily, weekly, weekly:0–6, or days:0,2,4');
  }
  const days = schedule.slice(5).split(',').map(Number);
  if (new Set(days).size !== days.length) throw new Error('Refresh days must not contain duplicates');
  return days.sort((a, b) => a - b);
}

export function normalizeSchedule(schedule: unknown, reference = new Date()): string | null {
  return serializeRefreshDays(parseRefreshDays(schedule, reference));
}

export function formatRefreshSchedule(schedule: string | null, reference = new Date()): string {
  const days = parseRefreshDays(schedule, reference);
  if (!days.length) return 'None · Manual refresh only';
  const label = days.length === 7 ? 'Every day' : days.map(day => WEEKDAYS[day].slice(0, 3)).join(', ');
  return `${label} · 00:00 UTC`;
}

/** The next selected midnight strictly after now; late jobs catch up once, then advance. */
export function nextRefreshDate(schedule: string, now = new Date()): Date {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid current date');
  const days = parseRefreshDays(schedule, now);
  if (!days.length) throw new Error('A refresh schedule must select at least one day');
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
    if (days.includes(candidate.getUTCDay())) return candidate;
  }
  throw new Error('Invalid refresh schedule');
}
