import { Artist, Track } from "./types";
import {
  fetchPlaylists,
  fetchAllArtistTracks,
  createPlaylist,
  addTracksToPlaylist,
  fetchProfile,
  fetchFollowedArtists,
  updatePlaylist,
} from "./api";
import {
  createPlaylistElement,
  createArtistElement,
  updateSelectedArtistsDisplay,
  updateCreatePlaylistButton,
  showStatusMessage,
  resetForm,
  clearArtistsGrid,
} from "./ui";

// State variables
let selectedArtists: Set<string> = new Set();
let selectedArtistNames: Map<string, string> = new Map(); // Map artist ID to name
let artistsLoaded = false;
let allFollowedArtists: Artist[] = []; // Cache all fetched artists
let searchTimeout: number | null = null; // Debounce search input

export async function loadPlaylists() {
  try {
    const playlistsData = await fetchPlaylists();
    const playlistsGrid = document.getElementById("playlists-grid")!;
    const loadingElement = document.getElementById("playlists-loading")!;

    loadingElement.style.display = "none";

    const handleUpdate = async (playlistId: string) => {
      const result = await updatePlaylist(playlistId);
      alert(`Playlist updated with ${result.trackCount} tracks from ${result.artistCount} artists!`);

      // Reload playlists
      playlistsGrid.innerHTML = "";
      loadingElement.style.display = "block";
      await loadPlaylists();
    };

    playlistsData.items.forEach((playlist) => {
      const playlistElement = createPlaylistElement(playlist, handleUpdate);
      playlistsGrid.appendChild(playlistElement);
    });
  } catch (error) {
    console.error("Error loading playlists:", error);
    document.getElementById("playlists-loading")!.innerText =
      "Error loading playlists";
  }
}

export async function loadFollowedArtists() {
  try {
    const artistsGrid = document.getElementById("artists-grid")!;
    const loadingElement = document.getElementById("artists-loading")!;
    const showMoreContainer = document.getElementById("show-more-container")!;

    loadingElement.style.display = "block";
    loadingElement.innerText = "Loading all followed artists...";

    // Fetch ALL followed artists with pagination
    allFollowedArtists = [];
    let afterCursor: string | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      const artistsData = await fetchFollowedArtists(50, afterCursor);
      allFollowedArtists.push(...artistsData.items);

      afterCursor = artistsData.next || undefined;
      hasMore = artistsData.next !== null;

      // Update loading message with progress
      loadingElement.innerText = `Loading followed artists... (${allFollowedArtists.length} found)`;
    }

    // Sort the entire list by popularity
    allFollowedArtists.sort((a, b) => b.followers.total - a.followers.total);

    loadingElement.style.display = "none";

    if (allFollowedArtists.length === 0) {
      // No followed artists found
      const noArtistsMessage = document.createElement("div");
      noArtistsMessage.className = "no-artists-message";
      noArtistsMessage.innerHTML = `
        <p>No followed artists found.</p>
        <p>Try following some of your favorite artists on Spotify first!</p>
      `;
      artistsGrid.appendChild(noArtistsMessage);
      showMoreContainer.style.display = "none";
      return;
    }

    // Clear the grid and display ALL artists
    artistsGrid.innerHTML = "";

    for (const artist of allFollowedArtists) {
      const artistElement = createArtistElement(artist, toggleArtistSelection);
      artistsGrid.appendChild(artistElement);
    }

    // Hide "Show More" button since all artists are displayed
    showMoreContainer.style.display = "none";
  } catch (error) {
    console.error("Error loading followed artists:", error);
    document.getElementById("artists-loading")!.innerText =
      "Error loading followed artists";
  }
}

function toggleArtistSelection(
  artistId: string,
  artistName: string,
  element: HTMLElement,
) {
  if (selectedArtists.has(artistId)) {
    selectedArtists.delete(artistId);
    selectedArtistNames.delete(artistId);
    element.classList.remove("selected");
  } else {
    selectedArtists.add(artistId);
    selectedArtistNames.set(artistId, artistName);
    element.classList.add("selected");
  }

  updateSelectedArtistsDisplay(selectedArtists, selectedArtistNames);
  updateCreatePlaylistButton(selectedArtists);
}

export async function handleCreatePlaylist() {
  const playlistName = (
    document.getElementById("playlist-name") as HTMLInputElement
  ).value.trim();
  const playlistDescription = (
    document.getElementById("playlist-description") as HTMLInputElement
  ).value.trim();
  const songCount = parseInt(
    (document.getElementById("song-count") as HTMLSelectElement).value
  );
  const createBtn = document.getElementById(
    "create-playlist-btn",
  ) as HTMLButtonElement;

  if (selectedArtists.size === 0 || !playlistName) {
    return;
  }

  createBtn.disabled = true;
  createBtn.textContent = "Creating Playlist...";
  showStatusMessage("Creating playlist and gathering songs...");

  try {
    // Get user profile for user ID
    const profile = await fetchProfile();

    // Create the playlist
    const playlist = await createPlaylist(
      profile.id,
      playlistName,
      playlistDescription,
    );
    showStatusMessage(
      `Playlist "${playlistName}" created! Gathering songs from selected artists...`,
    );

    // Get tracks from selected artists in parallel
    const artistIds = Array.from(selectedArtists);
    showStatusMessage(
      `Gathering songs from ${artistIds.length} selected artists...`,
    );

    const artistTracksPromises = artistIds.map(artistId =>
      fetchAllArtistTracks(artistId)
    );

    const results = await Promise.allSettled(artistTracksPromises);

    // Collect all tracks from successful requests
    const allTracks: Track[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allTracks.push(...result.value);
      } else {
        console.error('Error fetching tracks for artist:', result.reason);
      }
    }

    showStatusMessage(
      `Gathered ${allTracks.length} tracks from ${artistIds.length} artists!`,
    );

    // Shuffle and select the requested number of tracks
    const shuffledTracks = allTracks.sort(() => Math.random() - 0.5);
    const selectedTracks = shuffledTracks.slice(0, songCount);
    const trackUris = selectedTracks.map((track) => track.uri);

    showStatusMessage(`Adding ${selectedTracks.length} songs to playlist...`);

    // Add tracks to playlist
    await addTracksToPlaylist(playlist.id, trackUris);

    showStatusMessage(`
      <strong>Success!</strong> Playlist "${playlistName}" created with ${selectedTracks.length} songs!<br>
      <a href="${playlist.external_urls.spotify}" target="_blank" style="color: #1db954;">Open in Spotify</a>
    `);

    // Reset form
    resetForm();
    selectedArtists.clear();
    selectedArtistNames.clear();
    updateSelectedArtistsDisplay(selectedArtists, selectedArtistNames);

    // Reload playlists to show the new one
    document.getElementById("playlists-grid")!.innerHTML = "";
    document.getElementById("playlists-loading")!.style.display = "block";
    await loadPlaylists();
  } catch (error) {
    console.error("Error creating playlist:", error);
    showStatusMessage("Error creating playlist. Please try again.");
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = "Create Playlist";
    updateCreatePlaylistButton(selectedArtists);
  }
}

export async function showCreatePlaylistSection() {
  // Load artists only when the section is opened for the first time
  if (!artistsLoaded) {
    await loadFollowedArtists();
    artistsLoaded = true;
  }

  // Reset form
  resetForm();
  selectedArtists.clear();
  selectedArtistNames.clear();
  updateSelectedArtistsDisplay(selectedArtists, selectedArtistNames);
  updateCreatePlaylistButton(selectedArtists);
}

export function hideCreatePlaylistSection() {
  // Reset state
  artistsLoaded = false;
  allFollowedArtists = [];

  // Clear artists grid
  clearArtistsGrid();

  // Reset form and selections
  resetForm();
  selectedArtists.clear();
  selectedArtistNames.clear();
  updateSelectedArtistsDisplay(selectedArtists, selectedArtistNames);
}

export function getSelectedArtists(): Set<string> {
  return selectedArtists;
}

export function getSelectedArtistNames(): Map<string, string> {
  return selectedArtistNames;
}

export function removeArtistFromSelection(artistId: string) {
  // Remove from selected sets
  selectedArtists.delete(artistId);
  selectedArtistNames.delete(artistId);
  
  // Remove selected styling from the artist element if it's visible
  const artistElement = document.querySelector(`[data-artist-id="${artistId}"]`) as HTMLElement;
  if (artistElement) {
    artistElement.classList.remove("selected");
  }
  
  // Update the display
  updateSelectedArtistsDisplay(selectedArtists, selectedArtistNames);
  updateCreatePlaylistButton(selectedArtists);
}

// Search functionality
function searchArtists(query: string): Artist[] {
  if (!query.trim()) {
    return [];
  }
  
  const searchTerm = query.toLowerCase();
  return allFollowedArtists.filter(artist => 
    artist.name.toLowerCase().includes(searchTerm) ||
    artist.genres.some(genre => genre.toLowerCase().includes(searchTerm))
  ).slice(0, 10); // Limit to 10 results
}

function displaySearchResults(results: Artist[]) {
  const searchResults = document.getElementById('search-results')!;
  
  if (results.length === 0) {
    searchResults.style.display = 'none';
    return;
  }
  
  searchResults.innerHTML = '';
  
  results.forEach(artist => {
    const resultItem = document.createElement('div');
    resultItem.className = 'search-result-item';
    
    const imageUrl = artist.images[0]?.url || 'https://via.placeholder.com/40x40?text=No+Image';
    
    resultItem.innerHTML = `
      <img src="${imageUrl}" alt="${artist.name}" class="search-result-image">
      <div class="search-result-info">
        <div class="search-result-name">${artist.name}</div>
        <div class="search-result-details">${artist.followers.total.toLocaleString()} followers</div>
      </div>
    `;
    
    resultItem.addEventListener('click', () => {
      selectArtistFromSearch(artist);
      hideSearchResults();
    });
    
    searchResults.appendChild(resultItem);
  });
  
  searchResults.style.display = 'block';
}

function selectArtistFromSearch(artist: Artist) {
  // Clear search input
  const searchInput = document.getElementById('artist-search') as HTMLInputElement;
  searchInput.value = '';
  
  // Find the artist element in the grid or create it if not visible
  let artistElement = document.querySelector(`[data-artist-id="${artist.id}"]`) as HTMLElement;
  
  if (!artistElement) {
    // Artist is not currently displayed, add it to selected list directly
    if (!selectedArtists.has(artist.id)) {
      selectedArtists.add(artist.id);
      selectedArtistNames.set(artist.id, artist.name);
      updateSelectedArtistsDisplay(selectedArtists, selectedArtistNames);
      updateCreatePlaylistButton(selectedArtists);
    }
  } else {
    // Artist is visible, simulate a click
    toggleArtistSelection(artist.id, artist.name, artistElement);
  }
}

function hideSearchResults() {
  const searchResults = document.getElementById('search-results')!;
  searchResults.style.display = 'none';
}

function setupSearchEventListeners() {
  const searchInput = document.getElementById('artist-search') as HTMLInputElement;
  
  searchInput.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value;
    
    // Clear previous timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    // Debounce search
    searchTimeout = window.setTimeout(() => {
      const results = searchArtists(query);
      displaySearchResults(results);
    }, 300);
  });
  
  // Hide search results when clicking outside
  document.addEventListener('click', (e) => {
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer && !searchContainer.contains(e.target as Node)) {
      hideSearchResults();
    }
  });
  
  // Handle keyboard navigation
  searchInput.addEventListener('keydown', (e) => {
    const searchResults = document.getElementById('search-results')!;
    const resultItems = searchResults.querySelectorAll('.search-result-item');
    
    if (e.key === 'Escape') {
      hideSearchResults();
      searchInput.blur();
    } else if (e.key === 'ArrowDown' && resultItems.length > 0) {
      e.preventDefault();
      (resultItems[0] as HTMLElement).focus();
    }
  });
}

// Export the setup function to be called from main.ts
export function setupArtistSearch() {
  setupSearchEventListeners();
}
