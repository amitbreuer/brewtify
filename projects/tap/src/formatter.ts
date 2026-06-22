import { TapEvent, TapEventType } from './types';

const EMOJI: Record<TapEventType, string> = {
  'user.start': '🆕',
  'user.login': '🔑',
  'playlist.create': '🎵',
  'playlist.update': '🔄',
  'playlist.schedule': '📅',
  'cron.summary': '📊',
  'error.auth': '🔐',
  'error.general': '🚨',
};

export function formatEvent(event: TapEvent): string {
  const emoji = EMOJI[event.type] || '📌';
  const time = (event.timestamp || new Date()).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const lines: string[] = [];
  lines.push(`${emoji} <b>${formatType(event.type)}</b>`);

  if (event.userId || event.username) {
    const user = event.username ? `@${event.username}` : `user:${event.userId}`;
    lines.push(`👤 ${user}`);
  }

  lines.push(`💬 ${event.message}`);

  if (event.meta && Object.keys(event.meta).length > 0) {
    const metaStr = Object.entries(event.meta)
      .map(([k, v]) => `  • ${k}: ${String(v)}`)
      .join('\n');
    lines.push(metaStr);
  }

  lines.push(`🕐 ${time}`);

  const full = lines.join('\n');
  // Telegram message limit is 4096 characters
  return full.length > 4096 ? full.slice(0, 4093) + '...' : full;
}

function formatType(type: TapEventType): string {
  return type
    .replace('.', ' → ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
