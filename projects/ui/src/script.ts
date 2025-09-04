import { UserProfile, Playlist, Artist, PlaylistsResponse, ArtistsResponse, TracksResponse, Track } from './types';
import { CLIENT_ID, REDIRECT_URI } from './constants';

const clientId = CLIENT_ID;
const params = new URLSearchParams(window.location.search);
const code = params.get('code');

let accessToken: string;
let selectedArtists: Set<string> = new Set();

if (!code) {
  redirectToAuthCodeFlow(clientId);
} else {
  accessToken = await getAccessToken(clientId, code);
  const profile = await fetchProfile(accessToken);
  populateUI(profile);
  
  // Load playlists and followed artists
  await loadPlaylists(accessToken);
  await loadFollowedArtists(accessToken);
  
  // Set up event listeners
  setupEventListeners();
  
  const health = await fetch('http://localhost:3000/health');
  const healthData = await health.json();
  console.log('Health check:', healthData);
}

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

  const { access_token } = await result.json();
  return access_token;
}

async function fetchProfile(token: string): Promise<UserProfile> {
  const result = await fetch('https://api.spotify.com/v1/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}

async function fetchPlaylists(token: string): Promise<PlaylistsResponse> {
  const result = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}

async function fetchFollowedArtists(token: string): Promise<ArtistsResponse> {
  const result = await fetch('https://api.spotify.com/v1/me/following?type=artist&limit=50', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}

async function fetchArtistTopTracks(token: string, artistId: string): Promise<TracksResponse> {
  const result = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}

async function createPlaylist(token: string, userId: string, name: string, description: string): Promise<Playlist> {
  const result = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      description,
      public: false
    })
  });

  return await result.json();
}

async function addTracksToPlaylist(token: string, playlistId: string, trackUris: string[]): Promise<void> {
  // Spotify API allows max 100 tracks per request
  const chunks = [];
  for (let i = 0; i < trackUris.length; i += 100) {
    chunks.push(trackUris.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        uris: chunk
      })
    });
  }
}

function populateUI(profile: UserProfile) {
  document.getElementById('displayName')!.innerText = profile.display_name;
  if (profile.images[0]) {
    const profileImage = new Image(200, 200);
    profileImage.src = profile.images[0].url;
    document.getElementById('avatar')!.appendChild(profileImage);
  }
  document.getElementById('id')!.innerText = profile.id;
  document.getElementById('email')!.innerText = profile.email;
  document.getElementById('uri')!.innerText = profile.uri;
  document
    .getElementById('uri')!
    .setAttribute('href', profile.external_urls.spotify);
  document.getElementById('url')!.innerText = profile.href;
  document.getElementById('url')!.setAttribute('href', profile.href);
  document.getElementById('imgUrl')!.innerText =
    profile.images[0]?.url ?? '(no profile image)';
}

async function loadPlaylists(token: string) {
  try {
    const playlistsData = await fetchPlaylists(token);
    const playlistsGrid = document.getElementById('playlists-grid')!;
    const loadingElement = document.getElementById('playlists-loading')!;
    
    loadingElement.style.display = 'none';
    
    playlistsData.items.forEach(playlist => {
      const playlistElement = createPlaylistElement(playlist);
      playlistsGrid.appendChild(playlistElement);
    });
  } catch (error) {
    console.error('Error loading playlists:', error);
    document.getElementById('playlists-loading')!.innerText = 'Error loading playlists';
  }
}

async function loadFollowedArtists(token: string) {
  try {
    const artistsData = await fetchFollowedArtists(token);
    const artistsGrid = document.getElementById('artists-grid')!;
    const loadingElement = document.getElementById('artists-loading')!;
    
    loadingElement.style.display = 'none';
    
    artistsData.artists.items.forEach(artist => {
      const artistElement = createArtistElement(artist);
      artistsGrid.appendChild(artistElement);
    });
  } catch (error) {
    console.error('Error loading followed artists:', error);
    document.getElementById('artists-loading')!.innerText = 'Error loading followed artists';
  }
}

function createPlaylistElement(playlist: Playlist): HTMLElement {
  const playlistDiv = document.createElement('div');
  playlistDiv.className = 'playlist-item';
  
  const imageUrl = playlist.images[0]?.url || 'https://via.placeholder.com/150x150?text=No+Image';
  
  playlistDiv.innerHTML = `
    <img src="${imageUrl}" alt="${playlist.name}" class="item-image">
    <div class="item-name">${playlist.name}</div>
    <div class="item-details">${playlist.tracks.total} tracks</div>
    <div class="item-details">by ${playlist.owner.display_name}</div>
  `;
  
  playlistDiv.addEventListener('click', () => {
    window.open(playlist.external_urls.spotify, '_blank');
  });
  
  return playlistDiv;
}

function createArtistElement(artist: Artist): HTMLElement {
  const artistDiv = document.createElement('div');
  artistDiv.className = 'artist-item';
  artistDiv.dataset.artistId = artist.id;
  
  const imageUrl = artist.images[0]?.url || 'https://via.placeholder.com/150x150?text=No+Image';
  
  artistDiv.innerHTML = `
    <img src="${imageUrl}" alt="${artist.name}" class="item-image">
    <div class="item-name">${artist.name}</div>
    <div class="item-details">${artist.followers.total.toLocaleString()} followers</div>
    <div class="item-details">${artist.genres.slice(0, 2).join(', ')}</div>
  `;
  
  artistDiv.addEventListener('click', () => {
    toggleArtistSelection(artist.id, artist.name, artistDiv);
  });
  
  return artistDiv;
}

function toggleArtistSelection(artistId: string, artistName: string, element: HTMLElement) {
  if (selectedArtists.has(artistId)) {
    selectedArtists.delete(artistId);
    element.classList.remove('selected');
  } else {
    selectedArtists.add(artistId);
    element.classList.add('selected');
  }
  
  updateSelectedArtistsDisplay();
  updateCreatePlaylistButton();
}

function updateSelectedArtistsDisplay() {
  const displayElement = document.getElementById('selected-artists-display')!;
  
  if (selectedArtists.size === 0) {
    displayElement.innerHTML = '<em>No artists selected</em>';
    return;
  }
  
  const artistElements = Array.from(selectedArtists).map(artistId => {
    const artistElement = document.querySelector(`[data-artist-id="${artistId}"]`) as HTMLElement;
    const artistName = artistElement?.querySelector('.item-name')?.textContent || 'Unknown Artist';
    return `<span class="selected-artist-tag">${artistName}</span>`;
  });
  
  displayElement.innerHTML = artistElements.join('');
}

function updateCreatePlaylistButton() {
  const button = document.getElementById('create-playlist-btn') as HTMLButtonElement;
  const playlistName = (document.getElementById('playlist-name') as HTMLInputElement).value.trim();
  
  button.disabled = selectedArtists.size === 0 || playlistName === '';
}

function setupEventListeners() {
  const playlistNameInput = document.getElementById('playlist-name') as HTMLInputElement;
  const createPlaylistBtn = document.getElementById('create-playlist-btn') as HTMLButtonElement;
  
  playlistNameInput.addEventListener('input', updateCreatePlaylistButton);
  createPlaylistBtn.addEventListener('click', handleCreatePlaylist);
}

async function handleCreatePlaylist() {
  const playlistName = (document.getElementById('playlist-name') as HTMLInputElement).value.trim();
  const playlistDescription = (document.getElementById('playlist-description') as HTMLInputElement).value.trim();
  const createBtn = document.getElementById('create-playlist-btn') as HTMLButtonElement;
  const statusSection = document.getElementById('status')!;
  const statusMessage = document.getElementById('status-message')!;
  
  if (selectedArtists.size === 0 || !playlistName) {
    return;
  }
  
  createBtn.disabled = true;
  createBtn.textContent = 'Creating Playlist...';
  statusSection.style.display = 'block';
  statusMessage.textContent = 'Creating playlist and gathering songs...';
  
  try {
    // Get user profile for user ID
    const profile = await fetchProfile(accessToken);
    
    // Create the playlist
    const playlist = await createPlaylist(accessToken, profile.id, playlistName, playlistDescription);
    statusMessage.textContent = `Playlist "${playlistName}" created! Gathering songs from selected artists...`;
    
    // Get tracks from selected artists
    const allTracks: Track[] = [];
    const artistIds = Array.from(selectedArtists);
    
    for (const artistId of artistIds) {
      try {
        const tracksData = await fetchArtistTopTracks(accessToken, artistId);
        allTracks.push(...tracksData.tracks);
        statusMessage.textContent = `Gathered songs from ${allTracks.length} tracks so far...`;
      } catch (error) {
        console.error(`Error fetching tracks for artist ${artistId}:`, error);
      }
    }
    
    // Shuffle and select 50 tracks
    const shuffledTracks = allTracks.sort(() => Math.random() - 0.5);
    const selectedTracks = shuffledTracks.slice(0, 50);
    const trackUris = selectedTracks.map(track => track.uri);
    
    statusMessage.textContent = `Adding ${selectedTracks.length} songs to playlist...`;
    
    // Add tracks to playlist
    await addTracksToPlaylist(accessToken, playlist.id, trackUris);
    
    statusMessage.innerHTML = `
      <strong>Success!</strong> Playlist "${playlistName}" created with ${selectedTracks.length} songs!<br>
      <a href="${playlist.external_urls.spotify}" target="_blank" style="color: #1db954;">Open in Spotify</a>
    `;
    
    // Reset form
    (document.getElementById('playlist-name') as HTMLInputElement).value = '';
    (document.getElementById('playlist-description') as HTMLInputElement).value = '';
    selectedArtists.clear();
    document.querySelectorAll('.artist-item.selected').forEach(el => el.classList.remove('selected'));
    updateSelectedArtistsDisplay();
    
    // Reload playlists to show the new one
    document.getElementById('playlists-grid')!.innerHTML = '';
    document.getElementById('playlists-loading')!.style.display = 'block';
    await loadPlaylists(accessToken);
    
  } catch (error) {
    console.error('Error creating playlist:', error);
    statusMessage.textContent = 'Error creating playlist. Please try again.';
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = 'Create Playlist (50 songs)';
    updateCreatePlaylistButton();
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
