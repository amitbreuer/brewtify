export type SongLink =
  | { provider: 'spotify'; id: string; url: string }
  | { provider: 'apple_music'; id: string; storefront: string; url: string };

export class InvalidSongLink extends Error {}

export function parsePartySongLink(input: string): SongLink {
  const fail = (): never => { throw new InvalidSongLink('Invalid song link'); };
  if (typeof input !== 'string' || input.length > 2048) return fail();
  const text = input.trim();
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return { provider: 'spotify', id: uri[1], url: `https://open.spotify.com/track/${uri[1]}` };
  // Reject normalization of controls, backslashes and dot paths before parsing.
  if (!text || /[\u0000-\u0020\u007f\\]/.test(text) || !/^https:\/\//i.test(text)) return fail();
  let url: URL;
  try { url = new URL(text); } catch { return fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return fail();
  const authority = text.slice(text.indexOf('://') + 3).split(/[/?#]/, 1)[0];
  if (!/^(open\.spotify\.com|music\.apple\.com)$/i.test(authority)) return fail();
  const rawPath = text.slice(text.indexOf(authority) + authority.length).split(/[?#]/, 1)[0];
  if (rawPath !== url.pathname || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return fail();
  if (url.hostname === 'open.spotify.com') {
    const match = /^\/(?:intl-[a-z]{2}(?:-[A-Z]{2})?\/)?track\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
    if (!match) return fail();
    return { provider: 'spotify', id: match[1], url: `https://open.spotify.com/track/${match[1]}` };
  }
  if (url.hostname !== 'music.apple.com') return fail();
  const match = /^\/([a-z]{2})\/(song|album)\/(?:([^/]+)\/)?([1-9]\d{0,19})\/?$/.exec(url.pathname);
  if (!match) return fail();
  if (match[3]) {
    try {
      if (/[/\\\u0000-\u001f\u007f]/.test(decodeURIComponent(match[3]))) return fail();
    } catch { return fail(); }
  }
  const ids = url.searchParams.getAll('i');
  let id = match[4];
  if (match[2] === 'album') {
    if (ids.length !== 1 || !/^[1-9]\d{0,19}$/.test(ids[0])) return fail();
    id = ids[0];
  } else if (ids.length > 0) {
    return fail();
  }
  if (!Number.isSafeInteger(Number(id))) return fail();
  return { provider: 'apple_music', id, storefront: match[1], url: `https://music.apple.com/${match[1]}/song/${id}` };
}
