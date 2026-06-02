import { TapEvent } from './types';
import { TapConfig, loadConfig } from './config';
import { formatEvent } from './formatter';

class TapNotifier {
  private config: TapConfig;
  private usernames = new Map<string, string>();

  constructor(config?: Partial<TapConfig>) {
    const defaults = loadConfig();
    this.config = { ...defaults, ...config };
  }

  /** Register a userId → username mapping for enriching notifications */
  setUsername(userId: string, username: string): void {
    if (userId && username) {
      this.usernames.set(userId, username);
    }
  }

  async notify(event: TapEvent): Promise<void> {
    if (!this.config.enabled) return;

    // Auto-resolve username from registry if not provided
    if (!event.username && event.userId) {
      event = { ...event, username: this.usernames.get(event.userId) };
    }

    const text = formatEvent({ ...event, timestamp: event.timestamp || new Date() });

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.adminChatId,
          text,
          parse_mode: 'HTML',
          disable_notification: event.type.startsWith('cron.') || event.type === 'user.start',
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[tap] Failed to send notification: ${res.status} ${body}`);
      }
    } catch (err) {
      // Fire and forget — never throw
      console.error('[tap] Error sending notification:', err instanceof Error ? err.message : err);
    }
  }
}

// Singleton instance
let instance: TapNotifier | null = null;

export function getTap(): TapNotifier {
  if (!instance) {
    instance = new TapNotifier();
  }
  return instance;
}

export { TapNotifier };
