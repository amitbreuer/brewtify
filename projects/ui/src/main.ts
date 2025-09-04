import { CLIENT_ID } from './constants';
import { getAccessToken, redirectToAuthCodeFlow } from './auth';
import { fetchProfile } from './spotify';
import { populateUI, showCreatePlaylistSection, hideCreatePlaylistSection, updateCreatePlaylistButton } from './ui';
import { loadPlaylists, handleCreatePlaylist, loadMoreArtists, showCreatePlaylistSection as showPlaylistSection, hideCreatePlaylistSection as hidePlaylistSection, getSelectedArtists } from './playlists';

const clientId = CLIENT_ID;
const params = new URLSearchParams(window.location.search);
const code = params.get('code');

let accessToken: string;

if (!code) {
  redirectToAuthCodeFlow(clientId);
} else {
  accessToken = await getAccessToken(clientId, code);
  const profile = await fetchProfile(accessToken);
  populateUI(profile);
  
  // Load playlists only
  await loadPlaylists(accessToken);
  
  // Set up event listeners
  setupEventListeners();
  
  const health = await fetch('http://localhost:3000/health');
  const healthData = await health.json();
  console.log('Health check:', healthData);
}

function setupEventListeners() {
  const playlistNameInput = document.getElementById('playlist-name') as HTMLInputElement;
  const createPlaylistBtn = document.getElementById('create-playlist-btn') as HTMLButtonElement;
  const addPlaylistBtn = document.getElementById('add-playlist-btn') as HTMLButtonElement;
  const closeCreatePlaylistBtn = document.getElementById('close-create-playlist-btn') as HTMLButtonElement;
  const showMoreArtistsBtn = document.getElementById('show-more-artists-btn') as HTMLButtonElement;
  
  playlistNameInput.addEventListener('input', () => updateCreatePlaylistButton(getSelectedArtists()));
  createPlaylistBtn.addEventListener('click', () => handleCreatePlaylist(accessToken));
  addPlaylistBtn.addEventListener('click', handleShowCreatePlaylistSection);
  closeCreatePlaylistBtn.addEventListener('click', handleHideCreatePlaylistSection);
  showMoreArtistsBtn.addEventListener('click', () => loadMoreArtists(accessToken));
}

async function handleShowCreatePlaylistSection() {
  showCreatePlaylistSection();
  await showPlaylistSection(accessToken);
}

function handleHideCreatePlaylistSection() {
  hideCreatePlaylistSection();
  hidePlaylistSection();
}
