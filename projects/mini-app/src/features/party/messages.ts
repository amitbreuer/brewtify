const messages: Record<string, string> = {
  delivery_unknown: 'A queue command may already have reached Spotify. Automatic additions are paused until the host acknowledges this uncertainty.',
  delivery_settling: 'A previous Spotify queue command is still settling. Wait for the two-minute safety window before acknowledging or retrying. The song may already be queued; retrying afterward can still create a duplicate.',
  recording_changed: 'Spotify recording details changed. Resolve the request again and approve the version before adding.',
  unauthorized: 'Spotify authorization is no longer valid. The host needs to reconnect Party Spotify.',
  host_reconnect: 'The host needs to reconnect Spotify for Party. Library login remains separate.',
  reconnect_required: 'Reconnect Party Spotify to restore playback permission.',
  premium_required: 'Spotify confirmed Premium is required. Check the host subscription before continuing.',
  insufficient_scope: 'Spotify playback permission is missing. The host needs to reconnect Party Spotify and grant playback access.',
  device_unavailable: 'Spotify has no available active playback. The host should open Spotify, start playing music, then tap Try again.',
  rate_limited: 'Spotify is rate-limiting requests. Approved requests are waiting for a safe retry.',
  forbidden: 'Spotify denied playback access. Check the pilot allowlist and device restrictions; this does not necessarily mean Premium is missing.',
  apple_configuration: 'Apple Music catalog access is not configured. The Brewtify operator must configure it; guests do not need to sign in.',
  apple_unauthorized: 'Apple Music catalog credentials were rejected. The Brewtify operator must restore catalog access; no guest login is needed.',
  apple_rate_limited: 'Apple Music is limiting catalog requests. Matching will wait before retrying.',
  apple_unavailable: 'Apple Music catalog is temporarily unavailable. Try this request again later; this is not a confirmed no-match.',
  apple_invalid_response: 'Apple Music returned incomplete or unexpected song metadata. The host can retry later or use a Spotify song link.',
  apple_rejected: 'Apple Music rejected this catalog lookup. Check the individual song link and storefront, or try a Spotify song link.',
  room_closed: 'This party is closed. Tracks already queued remain in Spotify.',
  room_expired: 'This party has expired. Ask the host for a new invitation.',
};

export function partyFailureMessage(code: string): string {
  return messages[code] ?? `Party needs attention: ${code.replaceAll('_', ' ')}. Check the host’s Spotify connection and playback.`;
}
