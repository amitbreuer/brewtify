export interface Image {
  url: string;
  height: number;
  width: number;
}

export interface UserProfile {
  id: string;
  display_name: string;
  email: string;
  images: Image[];
  country: string;
  product: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  images: Image[];
  tracks: { total: number };
  external_urls: { spotify: string };
  owner: { display_name: string };
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
  album: { name: string; images: Image[]; release_date?: string };
  duration_ms: number;
  external_urls: { spotify: string };
  uri: string;
}
