import { CLIENT_ID } from './constants';
import { redirectToAuthCodeFlow, isAuthenticated, exchangeCodeForTokens } from './auth';
import { fetchProfile } from './api';
import { populateUI, showCreatePlaylistSection, hideCreatePlaylistSection, updateCreatePlaylistButton } from './ui';
import { loadPlaylists, handleCreatePlaylist, showCreatePlaylistSection as showPlaylistSection, hideCreatePlaylistSection as hidePlaylistSection, getSelectedArtists, setupArtistSearch } from './playlists';

const clientId = CLIENT_ID;
const params = new URLSearchParams(window.location.search);
const code = params.get('code');

// If we have a code, exchange it for tokens and store in backend session
if (code) {
  try {
    await exchangeCodeForTokens(clientId, code);
    // Clean up URL
    window.history.replaceState({}, document.title, '/');
    // Load the app directly (no need to reload)
    const profile = await fetchProfile();
    populateUI(profile);
    await loadPlaylists();
    setupEventListeners();
  } catch (error) {
    console.error('Failed to exchange code:', error);
    redirectToAuthCodeFlow(clientId);
  }
} else {
  // Check if user is authenticated
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    // Not authenticated - redirect to Spotify auth
    redirectToAuthCodeFlow(clientId);
  } else {
    // User is authenticated - load the app
    try {
      const profile = await fetchProfile();
      populateUI(profile);

      // Load playlists only
      await loadPlaylists();

      // Set up event listeners
      setupEventListeners();
    } catch (error) {
      console.error('Failed to load app:', error);
      // If loading fails, redirect to auth
      redirectToAuthCodeFlow(clientId);
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
