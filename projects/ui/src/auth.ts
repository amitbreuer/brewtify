import { CLIENT_ID, REDIRECT_URI } from './constants';
import { storeSession, checkAuthStatus } from './api';

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

  // Store verifier in localStorage for callback
  localStorage.setItem('code_verifier', verifier);

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('response_type', 'code');
  params.append('redirect_uri', REDIRECT_URI);
  params.append('scope', 'user-read-private user-read-email playlist-read-private playlist-modify-private playlist-modify-public user-follow-read');
  params.append('code_challenge_method', 'S256');
  params.append('code_challenge', challenge);

  // Redirect to Spotify authorization
  document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(clientId: string, code: string): Promise<void> {
  const verifier = localStorage.getItem('code_verifier');

  if (!verifier) {
    throw new Error('No code verifier found');
  }

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', REDIRECT_URI);
  params.append('code_verifier', verifier);

  const result = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!result.ok) {
    throw new Error('Failed to exchange code for tokens');
  }

  const { access_token, refresh_token, expires_in } = await result.json();

  // Send tokens to backend to store in session
  await storeSession(access_token, refresh_token, expires_in);

  // Clear code verifier
  localStorage.removeItem('code_verifier');
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    const status = await checkAuthStatus();
    return status.authenticated;
  } catch (error) {
    console.error('Failed to check auth status:', error);
    return false;
  }
}
