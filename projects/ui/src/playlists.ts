import { Artist, Track } from './types';
import { fetchPlaylists, fetchTopArtists, fetchArtistTopTracks, createPlaylist, addTracksToPlaylist, fetchProfile } from './spotify';
import { createPlaylistElement, createArtistElement, updateSelectedArtistsDisplay, updateCreatePlaylistButton, showStatusMessage, resetForm, clearArtistsGrid } from './ui';

// State variables
let selectedArtists: Set<string> = new Set();
let artistsLoaded = false;
let currentArtistOffset = 0;
let hasMoreArtists = true;

export async function loadPlaylists(token: string) {
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

export async function loadTopArtists(token: string, append: boolean = false) {
  try {
    const artistsData = await fetchTopArtists(token, 20, currentArtistOffset);
    const artistsGrid = document.getElementById('artists-grid')!;
    const loadingElement = document.getElementById('artists-loading')!;
    const showMoreContainer = document.getElementById('show-more-container')!;
    
    loadingElement.style.display = 'none';
    
    artistsData.items.forEach((artist: Artist) => {
      const artistElement = createArtistElement(artist, toggleArtistSelection);
      artistsGrid.appendChild(artistElement);
    });
    
    // Update pagination state
    currentArtistOffset += artistsData.items.length;
    hasMoreArtists = artistsData.next !== null && artistsData.items.length === 20;
    
    // Show/hide "Show More" button
    if (hasMoreArtists) {
      showMoreContainer.style.display = 'block';
    } else {
      showMoreContainer.style.display = 'none';
    }
    
  } catch (error) {
    console.error('Error loading top artists:', error);
    document.getElementById('artists-loading')!.innerText = 'Error loading top artists';
  }
}

export async function loadMoreArtists(token: string) {
  const showMoreBtn = document.getElementById('show-more-artists-btn') as HTMLButtonElement;
  
  showMoreBtn.disabled = true;
  showMoreBtn.textContent = 'Loading...';
  
  try {
    await loadTopArtists(token, true);
  } finally {
    showMoreBtn.disabled = false;
    showMoreBtn.textContent = 'Show More Artists';
  }
}

function toggleArtistSelection(artistId: string, artistName: string, element: HTMLElement) {
  if (selectedArtists.has(artistId)) {
    selectedArtists.delete(artistId);
    element.classList.remove('selected');
  } else {
    selectedArtists.add(artistId);
    element.classList.add('selected');
  }
  
  updateSelectedArtistsDisplay(selectedArtists);
  updateCreatePlaylistButton(selectedArtists);
}

export async function handleCreatePlaylist(token: string) {
  const playlistName = (document.getElementById('playlist-name') as HTMLInputElement).value.trim();
  const playlistDescription = (document.getElementById('playlist-description') as HTMLInputElement).value.trim();
  const createBtn = document.getElementById('create-playlist-btn') as HTMLButtonElement;
  
  if (selectedArtists.size === 0 || !playlistName) {
    return;
  }
  
  createBtn.disabled = true;
  createBtn.textContent = 'Creating Playlist...';
  showStatusMessage('Creating playlist and gathering songs...');
  
  try {
    // Get user profile for user ID
    const profile = await fetchProfile(token);
    
    // Create the playlist
    const playlist = await createPlaylist(token, profile.id, playlistName, playlistDescription);
    showStatusMessage(`Playlist "${playlistName}" created! Gathering songs from selected artists...`);
    
    // Get tracks from selected artists
    const allTracks: Track[] = [];
    const artistIds = Array.from(selectedArtists);
    
    for (const artistId of artistIds) {
      try {
        const tracksData = await fetchArtistTopTracks(token, artistId);
        allTracks.push(...tracksData.tracks);
        showStatusMessage(`Gathered songs from ${allTracks.length} tracks so far...`);
      } catch (error) {
        console.error(`Error fetching tracks for artist ${artistId}:`, error);
      }
    }
    
    // Shuffle and select 50 tracks
    const shuffledTracks = allTracks.sort(() => Math.random() - 0.5);
    const selectedTracks = shuffledTracks.slice(0, 50);
    const trackUris = selectedTracks.map(track => track.uri);
    
    showStatusMessage(`Adding ${selectedTracks.length} songs to playlist...`);
    
    // Add tracks to playlist
    await addTracksToPlaylist(token, playlist.id, trackUris);
    
    showStatusMessage(`
      <strong>Success!</strong> Playlist "${playlistName}" created with ${selectedTracks.length} songs!<br>
      <a href="${playlist.external_urls.spotify}" target="_blank" style="color: #1db954;">Open in Spotify</a>
    `);
    
    // Reset form
    resetForm();
    selectedArtists.clear();
    updateSelectedArtistsDisplay(selectedArtists);
    
    // Reload playlists to show the new one
    document.getElementById('playlists-grid')!.innerHTML = '';
    document.getElementById('playlists-loading')!.style.display = 'block';
    await loadPlaylists(token);
    
  } catch (error) {
    console.error('Error creating playlist:', error);
    showStatusMessage('Error creating playlist. Please try again.');
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = 'Create Playlist (50 songs)';
    updateCreatePlaylistButton(selectedArtists);
  }
}

export async function showCreatePlaylistSection(token: string) {
  // Load artists only when the section is opened for the first time
  if (!artistsLoaded) {
    await loadTopArtists(token);
    artistsLoaded = true;
  }
  
  // Reset form
  resetForm();
  selectedArtists.clear();
  updateSelectedArtistsDisplay(selectedArtists);
  updateCreatePlaylistButton(selectedArtists);
}

export function hideCreatePlaylistSection() {
  // Reset pagination state
  currentArtistOffset = 0;
  hasMoreArtists = true;
  artistsLoaded = false;
  
  // Clear artists grid
  clearArtistsGrid();
  
  // Reset form and selections
  resetForm();
  selectedArtists.clear();
  updateSelectedArtistsDisplay(selectedArtists);
}

export function getSelectedArtists(): Set<string> {
  return selectedArtists;
}
