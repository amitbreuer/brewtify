export type UserProfile = Readonly<{
  country: string;
  display_name: string;
  email: string;
  explicit_content: {
    filter_enabled: boolean;
    filter_locked: boolean;
  };
  external_urls: { spotify: string };
  followers: { href: string; total: number };
  href: string;
  id: string;
  images: Image[];
  product: string;
  type: string;
  uri: string;
}>;

type Image = Readonly<{
  url: string;
  height: number;
  width: number;
}>;

export type Playlist = Readonly<{
  id: string;
  name: string;
  images: Image[];
  tracks: {
    total: number;
  };
  external_urls: { spotify: string };
  owner: {
    display_name: string;
  };
}> & {
  description: string;
};

export type Artist = Readonly<{
  id: string;
  name: string;
  images: Image[];
  genres: string[];
  followers: { total: number };
  external_urls: { spotify: string };
}>;

export type Track = Readonly<{
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
}>;

export type Album = Readonly<{
  id: string;
  name: string;
  album_type: string;
  album_group?: string;
  total_tracks: number;
  release_date: string;
  images: Image[];
  artists: Artist[];
  external_urls: { spotify: string };
}>;

export type PlaylistsResponse = Readonly<{
  items: Playlist[];
  total: number;
}>;

export type ArtistsResponse = Readonly<{
  artists: {
    items: Artist[];
    total: number;
  };
}>;

export type TopArtistsResponse = Readonly<{
  items: Artist[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}>;

export type TracksResponse = Readonly<{
  tracks: Track[];
}>;

export type AlbumsResponse = Readonly<{
  items: Album[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}>;

export type AlbumTracksResponse = Readonly<{
  items: Track[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}>;
