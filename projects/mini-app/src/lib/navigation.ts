export type Section = 'library' | 'party';

export function inviteSecret(value: string): string | null {
  let payload = value.trim();
  if (payload.startsWith('https://')) {
    try {
      const url = new URL(payload);
      if (url.hostname !== 't.me' || url.username || url.password || url.port) return null;
      payload = url.searchParams.get('startapp') ?? '';
    } catch {
      return null;
    }
  }
  if (payload.startsWith('p_')) payload = payload.slice(2);
  return /^[A-Za-z0-9_-]{20,62}$/.test(payload) ? payload : null;
}

export function initialNavigation(search: string, signedInitData = ''): { section: Section; secret: string | null } {
  const params = new URLSearchParams(search);
  // Launch values only select a view; the server independently verifies initData and membership.
  const start = new URLSearchParams(signedInitData).get('start_param')
    ?? params.get('tgWebAppStartParam') ?? params.get('startapp') ?? '';
  const secret = start.startsWith('p_') ? inviteSecret(start) : null;
  const explicitSection = params.get('section');
  return {
    section: explicitSection === 'library' || explicitSection === 'party'
      ? explicitSection : start === 'party' || secret ? 'party' : 'library',
    secret,
  };
}

export function sectionUrl(href: string, section: Section): string {
  const url = new URL(href);
  url.searchParams.set('section', section);
  // Consume launch routing once; otherwise an invite would override an explicit Library switch on reload.
  url.searchParams.delete('tgWebAppStartParam');
  url.searchParams.delete('startapp');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function mergeFeed<T extends { id: string; createdAt: string; updatedAt: string }>(current: T[], changed: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of changed) {
    const previous = byId.get(item.id);
    if (!previous || item.updatedAt >= previous.updatedAt) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function retryDelay(failures: number, retryAfterMs = 0): number {
  return Math.max(retryAfterMs, Math.min(60_000, 3_000 * 2 ** Math.min(failures, 5)));
}
