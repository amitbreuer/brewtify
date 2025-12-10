import { CLIENT_ID } from './constants';
import { getAccessToken, redirectToAuthCodeFlow, getValidAccessToken } from './auth';
import { fetchProfile } from './spotify';
import { populateUI, showCreatePlaylistSection, hideCreatePlaylistSection, updateCreatePlaylistButton } from './ui';
import { loadPlaylists, handleCreatePlaylist, showCreatePlaylistSection as showPlaylistSection, hideCreatePlaylistSection as hidePlaylistSection, getSelectedArtists, setupArtistSearch } from './playlists';

const clientId = CLIENT_ID;
const params = new URLSearchParams(window.location.search);
const code = params.get('code');

let accessToken: string | null = null;

// First, try to get a valid stored access token
accessToken = await getValidAccessToken();

if (!accessToken && code) {
  // No stored token, but we have an auth code - exchange it for tokens
  accessToken = await getAccessToken(clientId, code);
  // Clean up the URL by removing the code parameter
  window.history.replaceState({}, document.title, '/');
} else if (!accessToken) {
  // No stored token and no auth code - redirect to Spotify auth
  redirectToAuthCodeFlow(clientId);
}

if (accessToken) {
  const profile = await fetchProfile(accessToken);
  populateUI(profile);

  // Load playlists only
  await loadPlaylists(accessToken);

  // Set up event listeners
  setupEventListeners();
}

function setupEventListeners() {
  const playlistNameInput = document.getElementById('playlist-name') as HTMLInputElement;
  const createPlaylistBtn = document.getElementById('create-playlist-btn') as HTMLButtonElement;
  const addPlaylistBtn = document.getElementById('add-playlist-btn') as HTMLButtonElement;
  const closeCreatePlaylistBtn = document.getElementById('close-create-playlist-btn') as HTMLButtonElement;

  playlistNameInput.addEventListener('input', () => updateCreatePlaylistButton(getSelectedArtists()));
  createPlaylistBtn.addEventListener('click', () => handleCreatePlaylist(accessToken as string));
  addPlaylistBtn.addEventListener('click', handleShowCreatePlaylistSection);
  closeCreatePlaylistBtn.addEventListener('click', handleHideCreatePlaylistSection);
}

async function handleShowCreatePlaylistSection() {
  showCreatePlaylistSection();
  await showPlaylistSection(accessToken as string);
  setupArtistSearch(); // Initialize search functionality
}

function handleHideCreatePlaylistSection() {
  hideCreatePlaylistSection();
  hidePlaylistSection();
}
