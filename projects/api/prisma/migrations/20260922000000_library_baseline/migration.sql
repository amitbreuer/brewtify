CREATE SCHEMA IF NOT EXISTS "public";
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "telegram_user_id" TEXT NOT NULL,
    "telegram_username" TEXT,
    "spotify_user_id" TEXT,
    "encrypted_access_token" TEXT,
    "encrypted_refresh_token" TEXT,
    "token_expires_at" BIGINT,
    "encryption_salt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "playlists" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "spotify_playlist_id" TEXT NOT NULL,
    "name" TEXT,
    "artist_ids" TEXT[],
    "track_count" INTEGER NOT NULL DEFAULT 50,
    "weights" JSONB,
    "era_preference" INTEGER NOT NULL DEFAULT 50,
    "era_preferences" JSONB,
    "schedule" TEXT,
    "next_update_at" TIMESTAMP(3),
    "last_updated_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "user_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "preferred_genres" TEXT[],
    "preferred_moods" TEXT[],
    "favorite_artist_ids" TEXT[],
    "max_tracks_per_artist" INTEGER NOT NULL DEFAULT 5,
    "exclude_explicit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_telegram_user_id_key" ON "users"("telegram_user_id");
CREATE INDEX "idx_due_updates" ON "playlists"("next_update_at");
CREATE UNIQUE INDEX "playlists_user_id_spotify_playlist_id_key" ON "playlists"("user_id", "spotify_playlist_id");
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
