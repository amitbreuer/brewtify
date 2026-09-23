const messages: Record<string, string> = {
  delivery_unknown: 'Spotify may already have queued this song. Additions are paused; the host must review before continuing.',
  delivery_settling: 'A previous Spotify queue command is still settling. Wait for the two-minute safety window before acknowledging or retrying. The song may already be queued; retrying afterward can still create a duplicate.',
  recording_changed: 'Spotify recording details changed. Resolve the request again and approve the version before adding.',
  unauthorized: 'Spotify authorization is no longer valid. The host needs to reconnect Party Spotify.',
  host_reconnect: 'The host needs to reconnect Spotify for Party.',
  reconnect_required: 'Reconnect Party Spotify to restore playback permission.',
  premium_required: 'Spotify confirmed Premium is required. Check the host subscription before continuing.',
  insufficient_scope: 'Spotify playback permission is missing. The host needs to reconnect Party Spotify and grant playback access.',
  catalog_insufficient_scope: 'Spotify denied song lookup permission. Try a direct Spotify link; reconnecting playback may not fix this.',
  catalog_forbidden: 'Spotify denied song lookup. Check the app’s Spotify access, or try a direct Spotify link.',
  device_unavailable: 'Spotify has no available active playback. The host should open Spotify, start playing music, then tap Try again.',
  rate_limited: 'Spotify is rate-limiting requests. Approved requests are waiting for a safe retry.',
  forbidden: 'Spotify denied playback access. Check Spotify app access and device restrictions; this does not necessarily mean Premium is missing.',
  itunes_rate_limited: 'iTunes Store is limiting song lookups. Matching will wait before retrying.',
  itunes_unavailable: 'iTunes Store lookup is temporarily unavailable. Try again later; this is not a confirmed no-match.',
  itunes_invalid_response: 'iTunes Store returned unexpected song metadata. The host can retry later or use a Spotify song link.',
  itunes_rejected: 'iTunes Store rejected this lookup. Check the Apple Music song link and storefront, or use a Spotify song link. Not every Apple Music song is in iTunes Store.',
  room_closed: 'This party is closed. Tracks already queued remain in Spotify.',
  room_expired: 'This party has expired. Ask the host for a new invitation.',
};

export function partyFailureMessage(code: string): string {
  return messages[code] ?? `Party needs attention: ${code.replaceAll('_', ' ')}. Check the host’s Spotify connection and playback.`;
}
