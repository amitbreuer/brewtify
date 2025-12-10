import { CLIENT_ID, REDIRECT_URI } from './constants';

export async function getAccessToken(
  clientId: string,
  code: string,
): Promise<string> {
  const verifier = localStorage.getItem('code_verifier');

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', REDIRECT_URI);
  params.append('code_verifier', verifier!);

  const result = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const { access_token, refresh_token, expires_in } = await result.json();

  // Store tokens and expiration time
  storeTokens(access_token, refresh_token, expires_in);

  return access_token;
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('spotify_refresh_token');

  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const params = new URLSearchParams();
  params.append('client_id', CLIENT_ID);
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);

  const result = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const { access_token, refresh_token: new_refresh_token, expires_in } = await result.json();

  // Store new access token and expiration, update refresh token if provided
  storeTokens(access_token, new_refresh_token || refreshToken, expires_in);

  return access_token;
}

function storeTokens(accessToken: string, refreshToken: string, expiresIn: number) {
  localStorage.setItem('spotify_access_token', accessToken);
  localStorage.setItem('spotify_refresh_token', refreshToken);

  // Calculate expiration time (current time + expires_in seconds - 60 second buffer)
  const expirationTime = Date.now() + (expiresIn - 60) * 1000;
  localStorage.setItem('spotify_token_expiration', expirationTime.toString());
}

function isTokenExpired(): boolean {
  const expirationTime = localStorage.getItem('spotify_token_expiration');

  if (!expirationTime) {
    return true;
  }

  return Date.now() >= parseInt(expirationTime);
}

export async function getValidAccessToken(): Promise<string | null> {
  const accessToken = localStorage.getItem('spotify_access_token');
  const refreshToken = localStorage.getItem('spotify_refresh_token');

  // No tokens stored
  if (!accessToken || !refreshToken) {
    return null;
  }

  // Token is still valid
  if (!isTokenExpired()) {
    return accessToken;
  }

  // Token expired, refresh it
  try {
    return await refreshAccessToken();
  } catch (error) {
    console.error('Failed to refresh token:', error);
    // Clear invalid tokens
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('spotify_token_expiration');
    return null;
  }
}

function generateCodeVerifier(length: number) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function generateCodeChallenge(codeVerifier: string) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function redirectToAuthCodeFlow(clientId: string) {
  const verifier = generateCodeVerifier(128);
  const challenge = await generateCodeChallenge(verifier);

  localStorage.setItem('code_verifier', verifier);

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('response_type', 'code');
  params.append('redirect_uri', REDIRECT_URI);
  params.append('scope', 'user-read-private user-read-email playlist-read-private playlist-modify-private playlist-modify-public user-follow-read');
  params.append('code_challenge_method', 'S256');
  params.append('code_challenge', challenge);
  document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}
