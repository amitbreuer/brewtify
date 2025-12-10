import { Artist, Track } from "./types";
import {
  fetchPlaylists,
  fetchArtistTopTracks,
  createPlaylist,
  addTracksToPlaylist,
  fetchProfile,
  fetchFollowedArtists,
} from "./spotify";
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
let currentAfterCursor: string | null = null;
let hasMoreArtists = true;
let allFollowedArtists: Artist[] = []; // Cache all fetched artists
let displayedArtistsCount = 0; // Track how many artists are currently displayed
let searchTimeout: number | null = null; // Debounce search input

export async function loadPlaylists(token: string) {
  try {
    const playlistsData = await fetchPlaylists(token);
    const playlistsGrid = document.getElementById("playlists-grid")!;
    const loadingElement = document.getElementById("playlists-loading")!;

    loadingElement.style.display = "none";

    playlistsData.items.forEach((playlist) => {
      const playlistElement = createPlaylistElement(playlist);
      playlistsGrid.appendChild(playlistElement);
    });
  } catch (error) {
    console.error("Error loading playlists:", error);
    document.getElementById("playlists-loading")!.innerText =
      "Error loading playlists";
  }
}

export async function loadFollowedArtists(
  token: string,
  append: boolean = false,
) {
  try {
    const artistsGrid = document.getElementById("artists-grid")!;
    const loadingElement = document.getElementById("artists-loading")!;
    const showMoreContainer = document.getElementById("show-more-container")!;

    // Fetch new artists from API
    const artistsData = await fetchFollowedArtists(
      token,
      30,
      currentAfterCursor || undefined,
    );

    // Add new artists to our cache
    allFollowedArtists.push(...artistsData.items);

    // Update pagination state
    currentAfterCursor = artistsData.next;
    hasMoreArtists = artistsData.next !== null;

    // Sort the entire cached list by popularity
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

    // Clear the grid if this is not an append operation
    if (!append) {
      artistsGrid.innerHTML = "";
      displayedArtistsCount = 0;
    }

    // Calculate how many more artists to display (30 more, or remaining)
    const artistsToShow = append ? 30 : 30;
    const endIndex = Math.min(
      displayedArtistsCount + artistsToShow,
      allFollowedArtists.length,
    );

    // Display artists from the sorted cache
    for (let i = displayedArtistsCount; i < endIndex; i++) {
      const artist = allFollowedArtists[i];
      const artistElement = createArtistElement(artist, toggleArtistSelection);
      artistsGrid.appendChild(artistElement);
    }

    // Update displayed count
    displayedArtistsCount = endIndex;

    // Show/hide "Show More" button based on whether there are more artists to display or fetch
    const hasMoreToDisplay = displayedArtistsCount < allFollowedArtists.length;
    if (hasMoreToDisplay || hasMoreArtists) {
      showMoreContainer.style.display = "block";
    } else {
      showMoreContainer.style.display = "none";
    }
  } catch (error) {
    console.error("Error loading followed artists:", error);
    document.getElementById("artists-loading")!.innerText =
      "Error loading followed artists";
  }
}

export async function loadMoreArtists(token: string) {
  const showMoreBtn = document.getElementById(
    "show-more-artists-btn",
  ) as HTMLButtonElement;

  showMoreBtn.disabled = true;
  showMoreBtn.textContent = "Loading...";

  try {
    // Check if we have more cached artists to display
    const hasMoreCachedToDisplay =
      displayedArtistsCount < allFollowedArtists.length;

    if (hasMoreCachedToDisplay) {
      // Display more from cache without API call
      const artistsGrid = document.getElementById("artists-grid")!;
      const artistsToShow = 30;
      const endIndex = Math.min(
        displayedArtistsCount + artistsToShow,
        allFollowedArtists.length,
      );

      // Display artists from the sorted cache
      for (let i = displayedArtistsCount; i < endIndex; i++) {
        const artist = allFollowedArtists[i];
        const artistElement = createArtistElement(
          artist,
          toggleArtistSelection,
        );
        artistsGrid.appendChild(artistElement);
      }

      // Update displayed count
      displayedArtistsCount = endIndex;

      // Check if we still have more to show
      const stillHasMoreToDisplay =
        displayedArtistsCount < allFollowedArtists.length;
      const showMoreContainer = document.getElementById("show-more-container")!;

      if (stillHasMoreToDisplay || hasMoreArtists) {
        showMoreContainer.style.display = "block";
      } else {
        showMoreContainer.style.display = "none";
      }
    } else if (hasMoreArtists) {
      // Fetch more artists from API
      await loadFollowedArtists(token, true);
    }
  } finally {
    showMoreBtn.disabled = false;
    showMoreBtn.textContent = 'Show More Artists';
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

export async function handleCreatePlaylist(token: string) {
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
    const profile = await fetchProfile(token);

    // Create the playlist
    const playlist = await createPlaylist(
      token,
      profile.id,
      playlistName,
      playlistDescription,
    );
    showStatusMessage(
      `Playlist "${playlistName}" created! Gathering songs from selected artists...`,
    );

    // Get tracks from selected artists
    const allTracks: Track[] = [];
    const artistIds = Array.from(selectedArtists);

    for (const artistId of artistIds) {
      try {
        const tracksData = await fetchArtistTopTracks(token, artistId);
        allTracks.push(...tracksData.tracks);
        showStatusMessage(
          `Gathered songs from ${allTracks.length} tracks so far...`,
        );
      } catch (error) {
        console.error(`Error fetching tracks for artist ${artistId}:`, error);
      }
    }

    // Shuffle and select the requested number of tracks
    const shuffledTracks = allTracks.sort(() => Math.random() - 0.5);
    const selectedTracks = shuffledTracks.slice(0, songCount);
    const trackUris = selectedTracks.map((track) => track.uri);

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
    selectedArtistNames.clear();
    updateSelectedArtistsDisplay(selectedArtists, selectedArtistNames);

    // Reload playlists to show the new one
    document.getElementById("playlists-grid")!.innerHTML = "";
    document.getElementById("playlists-loading")!.style.display = "block";
    await loadPlaylists(token);
  } catch (error) {
    console.error("Error creating playlist:", error);
    showStatusMessage("Error creating playlist. Please try again.");
  } finally {
    createBtn.disabled = false;
    createBtn.textContent = "Create Playlist";
    updateCreatePlaylistButton(selectedArtists);
  }
}

export async function showCreatePlaylistSection(token: string) {
  // Load artists only when the section is opened for the first time
  if (!artistsLoaded) {
    await loadFollowedArtists(token);
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
  // Reset pagination state
  currentAfterCursor = null;
  hasMoreArtists = true;
  artistsLoaded = false;

  // Reset cache and display state
  allFollowedArtists = [];
  displayedArtistsCount = 0;

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
