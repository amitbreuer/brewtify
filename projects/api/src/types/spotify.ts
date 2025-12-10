export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface UserProfile {
  country: string;
  display_name: string;
  email: string;
  id: string;
  images: Image[];
  product: string;
  uri: string;
}

export interface Image {
  url: string;
  height: number;
  width: number;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  images: Image[];
  tracks: {
    total: number;
  };
  external_urls: { spotify: string };
  owner: {
    display_name: string;
  };
}

export interface Artist {
  id: string;
  name: string;
  images: Image[];
  genres: string[];
  followers: { total: number };
  external_urls: { spotify: string };
}

export interface Track {
  id: string;
  name: string;
  artists: Artist[];
  album: {
    name: string;
    images: Image[];
  };
  duration_ms: number;
  external_urls: { spotify: string };
  uri: string;
}

export interface Album {
  id: string;
  name: string;
  album_type: string;
  album_group?: string;
  total_tracks: number;
  release_date: string;
  images: Image[];
  artists: Artist[];
}
