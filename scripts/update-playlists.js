/**
 * Script to update auto-update enabled playlists
 * Runs weekly via GitHub Actions
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS_BASE = 'https://accounts.spotify.com';

// Cache configuration
const CACHE_DIR = path.join(process.cwd(), '.cache');
const TWO_MONTHS_MS = 60 * 24 * 60 * 60 * 1000; // 2 months in milliseconds

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Cache helper functions
 */
function getCacheFilePath(key) {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  return path.join(CACHE_DIR, `${hash}.json`);
}

function getFromCache(key, ttl) {
  const filePath = getCacheFilePath(key);

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(content);

    // Check if TTL is defined and if the cache has expired
    if (ttl !== undefined) {
      const now = Date.now();
      const age = now - entry.timestamp;

      if (age > ttl) {
        // Cache expired, delete the file
        fs.unlinkSync(filePath);
        return null;
      }
    }

    return entry.data;
  } catch (error) {
    // If there's any error reading/parsing, treat as cache miss
    console.error('Cache read error:', error);
    return null;
  }
}

function setInCache(key, data, ttl) {
  const filePath = getCacheFilePath(key);

  const entry = {
    data,
    timestamp: Date.now(),
    ttl,
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
  } catch (error) {
    console.error('Cache write error:', error);
  }
}

// Get credentials from environment
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('Missing required environment variables');
  process.exit(1);
}

/**
 * Update GitHub secret using GitHub CLI (pre-installed in Actions)
 */
async function updateGitHubSecretWithCLI(newRefreshToken) {
  const { execSync } = require('child_process');
  const githubToken = process.env.GH_PAT;
  const repo = process.env.GITHUB_REPOSITORY; // Format: "owner/repo"

  if (!githubToken || !repo) {
    console.log('   ℹ️  Not running in GitHub Actions with GH_PAT - secret not auto-updated');
    return false;
  }

  try {
    // Use GitHub CLI to update the secret
    execSync(
      `echo "${newRefreshToken}" | gh secret set SPOTIFY_REFRESH_TOKEN --repo ${repo}`,
      {
        env: { ...process.env, GH_TOKEN: githubToken },
        stdio: 'pipe',
      }
    );

    console.log('   ✅ GitHub secret SPOTIFY_REFRESH_TOKEN updated successfully!');
    return true;
  } catch (error) {
    console.error('   ❌ Failed to update GitHub secret:', error.message);
    return false;
  }
}

/**
 * Get access token using refresh token
 */
async function getAccessToken() {
  const params = new URLSearchParams();
  params.append('client_id', CLIENT_ID);
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', REFRESH_TOKEN);

  const authHeader = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`❌ Token request failed (${response.status}):`, errorBody);
    throw new Error(`Failed to get access token: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();

  // Check if Spotify returned a new refresh token
  if (data.refresh_token && data.refresh_token !== REFRESH_TOKEN) {
    console.log('⚠️  Spotify returned a new refresh token!');

    // Try to update GitHub secret automatically using CLI
    const updated = await updateGitHubSecretWithCLI(data.refresh_token);

    if (!updated) {
      console.log('   📝 Manual action required:');
      console.log('   Update SPOTIFY_REFRESH_TOKEN in your environment/secrets to:');
      console.log(`   ${data.refresh_token}`);
      console.log('   The old refresh token has been revoked by Spotify.');
    }
  }

  return data.access_token;
}

/**
 * Make Spotify API request
 */
async function makeRequest(endpoint, accessToken, options = {}) {
  const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Spotify API error: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Parse artist IDs from playlist description
 * Looks for pattern: [Auto-update: id1,id2,id3]
 */
function parseArtistIdsFromDescription(description) {
  if (!description) return [];

  // Try new format first: [Auto-update: id1,id2,id3]
  let match = description.match(/\[Auto-update:\s*([^\]]+)\]/);
  if (match) {
    return match[1].split(',').map(id => id.trim()).filter(id => id.length > 0);
  }

  // Fallback to old format: ARTISTS:id1,id2,id3
  match = description.match(/ARTISTS:([a-zA-Z0-9,]+)/);
  if (match) {
    return match[1].split(',').filter(Boolean);
  }

  return [];
}

/**
 * Select random tracks from multiple artists
 */
function selectRandomTracks(artistsTracks, trackCount) {
  const allTracks = [];

  // Flatten all tracks
  for (const tracks of artistsTracks.values()) {
    allTracks.push(...tracks);
  }

  // Shuffle and select
  const shuffled = allTracks.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(trackCount, shuffled.length));
}

/**
 * Get all tracks for an artist
 */
async function getAllArtistTracks(accessToken, artistId) {
  // Check cache for artist albums (2 month TTL)
  const albumsCacheKey = `artist-albums:${artistId}:20:0`;
  let albumsResponse = getFromCache(albumsCacheKey, TWO_MONTHS_MS);

  if (!albumsResponse) {
    // Fetch 20 albums
    albumsResponse = await makeRequest(
      `/artists/${artistId}/albums?limit=20`,
      accessToken
    );
    // Store in cache
    setInCache(albumsCacheKey, albumsResponse, TWO_MONTHS_MS);
  }

  // Fetch tracks for each album in parallel
  const trackPromises = albumsResponse.items.map(async (album) => {
    // Check cache for album tracks (permanent cache)
    const tracksCacheKey = `album-tracks:${album.id}:30:0`;
    let tracksResponse = getFromCache(tracksCacheKey);

    if (!tracksResponse) {
      tracksResponse = await makeRequest(
        `/albums/${album.id}/tracks?limit=30`,
        accessToken
      );
      // Store in cache (no TTL - permanent)
      setInCache(tracksCacheKey, tracksResponse);
    }

    return tracksResponse.items;
  });

  const results = await Promise.allSettled(trackPromises);

  // Flatten and deduplicate
  const seenIds = new Set();
  const allTracks = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const track of result.value) {
        if (!seenIds.has(track.id)) {
          seenIds.add(track.id);
          allTracks.push(track);
        }
      }
    }
  }

  return allTracks;
}

/**
 * Add tracks to playlist
 */
async function addTracksToPlaylist(accessToken, playlistId, trackUris) {
  const chunks = [];
  for (let i = 0; i < trackUris.length; i += 100) {
    chunks.push(trackUris.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    await makeRequest(
      `/playlists/${playlistId}/tracks`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ uris: chunk }),
      }
    );
  }
}

/**
 * Replace playlist tracks
 */
async function replacePlaylistTracks(accessToken, playlistId, trackUris) {
  // First chunk replaces
  const firstChunk = trackUris.slice(0, 100);
  await makeRequest(
    `/playlists/${playlistId}/tracks`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({ uris: firstChunk }),
    }
  );

  // Remaining chunks append
  if (trackUris.length > 100) {
    const remainingUris = trackUris.slice(100);
    await addTracksToPlaylist(accessToken, playlistId, remainingUris);
  }
}

/**
 * Fill playlist with tracks from artists
 */
async function fillPlaylist(accessToken, playlistId, artistIds, trackCount, replaceExisting = false) {
  try {
    // Fetch tracks for all artists in parallel
    const trackPromises = artistIds.map((artistId) =>
      getAllArtistTracks(accessToken, artistId)
    );

    const results = await Promise.allSettled(trackPromises);

    // Collect tracks by artist
    const artistsTracks = new Map();
    artistIds.forEach((artistId, index) => {
      const result = results[index];
      if (result.status === 'fulfilled') {
        artistsTracks.set(artistId, result.value);
      }
    });

    // Select random tracks
    const selectedTracks = selectRandomTracks(artistsTracks, trackCount);

    if (selectedTracks.length === 0) {
      return {
        success: false,
        trackCount: 0,
        error: 'No tracks found for selected artists',
      };
    }

    // Get track URIs
    const trackUris = selectedTracks.map((track) => track.uri);

    // Update playlist
    if (replaceExisting) {
      await replacePlaylistTracks(accessToken, playlistId, trackUris);
    } else {
      await addTracksToPlaylist(accessToken, playlistId, trackUris);
    }

    return {
      success: true,
      trackCount: selectedTracks.length,
    };
  } catch (error) {
    return {
      success: false,
      trackCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Read playlist config file
 */
function readConfig() {
  const configPath = path.join(__dirname, '../playlists-config.json');
  const content = fs.readFileSync(configPath, 'utf-8');
  const data = JSON.parse(content);
  return data.playlistIds || [];
}

/**
 * Main function
 */
async function main() {
  console.log('🎵 Starting playlist update...');

  // Get access token
  console.log('📡 Getting access token...');
  const accessToken = await getAccessToken();

  // Read config
  let playlistIds = readConfig();

  // Filter by playlist ID if specified
  const targetPlaylistId = process.env.PLAYLIST_ID;
  if (targetPlaylistId) {
    console.log(`🎯 Filtering for specific playlist: ${targetPlaylistId}`);
    playlistIds = playlistIds.filter((id) => id === targetPlaylistId);

    if (playlistIds.length === 0) {
      console.log(`❌ Playlist ${targetPlaylistId} not found in config`);
      return;
    }
  }

  console.log(`📋 Found ${playlistIds.length} playlist(s) to update`);

  if (playlistIds.length === 0) {
    console.log('✅ No playlists to update');
    return;
  }

  // Update each playlist
  for (const playlistId of playlistIds) {
    try {
      // Fetch playlist details
      console.log(`\n🎶 Fetching playlist details: ${playlistId}`);
      const playlistDetails = await makeRequest(
        `/playlists/${playlistId}`,
        accessToken
      );

      const playlistName = playlistDetails.name;
      const trackCount = playlistDetails.tracks.total;
      const description = playlistDetails.description;

      console.log(`   Name: ${playlistName}`);
      console.log(`   Current tracks: ${trackCount}`);

      // Parse artist IDs from description
      const artistIds = parseArtistIdsFromDescription(description);

      if (artistIds.length === 0) {
        console.log(`   ⚠️  No artist IDs found in description - skipping`);
        continue;
      }

      console.log(`   Artists: ${artistIds.length}`);

      // Update playlist
      const result = await fillPlaylist(
        accessToken,
        playlistId,
        artistIds,
        trackCount,
        true // Replace existing tracks
      );

      if (result.success) {
        console.log(`   ✅ Updated with ${result.trackCount} tracks`);
      } else {
        console.error(`   ❌ Failed: ${result.error}`);
      }
    } catch (error) {
      console.error(`   ❌ Error:`, error);
    }
  }

  console.log('\n✨ Playlist update complete!');
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
