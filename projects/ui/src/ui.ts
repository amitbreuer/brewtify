import { UserProfile, Playlist, Artist } from './types';

export function populateUI(profile: UserProfile) {
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

export function createPlaylistElement(playlist: Playlist): HTMLElement {
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

export function createArtistElement(artist: Artist, onToggleSelection: (artistId: string, artistName: string, element: HTMLElement) => void): HTMLElement {
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
    onToggleSelection(artist.id, artist.name, artistDiv);
  });
  
  return artistDiv;
}

export function updateSelectedArtistsDisplay(selectedArtists: Set<string>) {
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

export function updateCreatePlaylistButton(selectedArtists: Set<string>) {
  const button = document.getElementById('create-playlist-btn') as HTMLButtonElement;
  const playlistName = (document.getElementById('playlist-name') as HTMLInputElement).value.trim();
  
  button.disabled = selectedArtists.size === 0 || playlistName === '';
}

export function showStatusMessage(message: string) {
  const statusSection = document.getElementById('status')!;
  const statusMessage = document.getElementById('status-message')!;
  
  statusSection.style.display = 'block';
  statusMessage.innerHTML = message;
}

export function hideStatusMessage() {
  const statusSection = document.getElementById('status')!;
  statusSection.style.display = 'none';
}

export function resetForm() {
  (document.getElementById('playlist-name') as HTMLInputElement).value = '';
  (document.getElementById('playlist-description') as HTMLInputElement).value = '';
  document.querySelectorAll('.artist-item.selected').forEach(el => el.classList.remove('selected'));
}

export function clearArtistsGrid() {
  document.getElementById('artists-grid')!.innerHTML = '';
  document.getElementById('show-more-container')!.style.display = 'none';
  document.getElementById('artists-loading')!.style.display = 'block';
}

export function showCreatePlaylistSection() {
  const createPlaylistSection = document.getElementById('create-playlist-section')!;
  createPlaylistSection.style.display = 'block';
  createPlaylistSection.scrollIntoView({ behavior: 'smooth' });
}

export function hideCreatePlaylistSection() {
  const createPlaylistSection = document.getElementById('create-playlist-section')!;
  createPlaylistSection.style.display = 'none';
  hideStatusMessage();
}
