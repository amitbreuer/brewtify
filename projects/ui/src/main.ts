import { CLIENT_ID } from './constants';
import { redirectToAuthCodeFlow, isAuthenticated, exchangeCodeForTokens } from './auth';
import { fetchProfile } from './api';
import { populateUI, showCreatePlaylistSection, hideCreatePlaylistSection, updateCreatePlaylistButton } from './ui';
import { loadPlaylists, handleCreatePlaylist, showCreatePlaylistSection as showPlaylistSection, hideCreatePlaylistSection as hidePlaylistSection, getSelectedArtists, setupArtistSearch } from './playlists';

const clientId = CLIENT_ID;
const params = new URLSearchParams(window.location.search);
const code = params.get('code');

// Guard against redirect loops — if we've already redirected recently, stop
const REDIRECT_GUARD_KEY = 'auth_redirect_ts';
const REDIRECT_COOLDOWN_MS = 5000;

function canRedirect(): boolean {
  const lastRedirect = sessionStorage.getItem(REDIRECT_GUARD_KEY);
  if (lastRedirect && Date.now() - Number(lastRedirect) < REDIRECT_COOLDOWN_MS) {
    return false;
  }
  return true;
}

function safeRedirectToAuth() {
  if (!canRedirect()) {
    console.error('Auth redirect loop detected — stopping.');
    document.body.innerHTML = '<h1>Authentication failed. Please clear your cookies and try again.</h1>';
    return;
  }
  sessionStorage.setItem(REDIRECT_GUARD_KEY, String(Date.now()));
  redirectToAuthCodeFlow(clientId);
}

// If we have a code, exchange it for tokens and store in backend session
if (code) {
  // Clean up URL immediately to prevent code reuse on refresh/HMR
  window.history.replaceState({}, document.title, '/');
  try {
    await exchangeCodeForTokens(clientId, code);
    sessionStorage.removeItem(REDIRECT_GUARD_KEY);
    // Load the app directly (no need to reload)
    const profile = await fetchProfile();
    populateUI(profile);
    await loadPlaylists();
    setupEventListeners();
  } catch (error) {
    console.error('Failed to exchange code:', error);
    safeRedirectToAuth();
  }
} else {
  // Check if user is authenticated
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    safeRedirectToAuth();
  } else {
    // User is authenticated - load the app
    sessionStorage.removeItem(REDIRECT_GUARD_KEY);
    try {
      const profile = await fetchProfile();
      populateUI(profile);

      // Load playlists only
      await loadPlaylists();

      // Set up event listeners
      setupEventListeners();
    } catch (error) {
      console.error('Failed to load app:', error);
      safeRedirectToAuth();
    }
  }
}

function setupEventListeners() {
  const playlistNameInput = document.getElementById('playlist-name') as HTMLInputElement;
  const createPlaylistBtn = document.getElementById('create-playlist-btn') as HTMLButtonElement;
  const addPlaylistBtn = document.getElementById('add-playlist-btn') as HTMLButtonElement;
  const closeCreatePlaylistBtn = document.getElementById('close-create-playlist-btn') as HTMLButtonElement;

  playlistNameInput.addEventListener('input', () => updateCreatePlaylistButton(getSelectedArtists()));
  createPlaylistBtn.addEventListener('click', () => handleCreatePlaylist());
  addPlaylistBtn.addEventListener('click', handleShowCreatePlaylistSection);
  closeCreatePlaylistBtn.addEventListener('click', handleHideCreatePlaylistSection);
}

async function handleShowCreatePlaylistSection() {
  showCreatePlaylistSection();
  await showPlaylistSection();
  setupArtistSearch(); // Initialize search functionality
}

function handleHideCreatePlaylistSection() {
  hideCreatePlaylistSection();
  hidePlaylistSection();
}
