-- Schema cho PostgreSQL local database
-- Bảng videos - chứa dữ liệu video (chuyển từ Supabase videos-ver1)

CREATE TABLE IF NOT EXISTS videos (
    id SERIAL PRIMARY KEY,
    title TEXT,
    url TEXT UNIQUE NOT NULL,
    channel_name TEXT,
    views INTEGER DEFAULT 0,
    date_published TIMESTAMPTZ,
    thumbnail TEXT,
    caption TEXT,
    summary TEXT,
    video_key TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Full-Text Search columns (tsvector)
    -- fts: tìm tất cả (title + summary + caption + channel_name)
    fts TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(caption, '') || ' ' || coalesce(channel_name, ''))
    ) STORED,
    
    -- fts_no_caption: tìm không bao gồm caption
    fts_no_caption TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(channel_name, ''))
    ) STORED
);

-- Indexes cho performance
CREATE INDEX IF NOT EXISTS idx_videos_url ON videos(url);
CREATE INDEX IF NOT EXISTS idx_videos_channel_name ON videos(channel_name);
CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(views);
CREATE INDEX IF NOT EXISTS idx_videos_date_published ON videos(date_published);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
CREATE INDEX IF NOT EXISTS idx_videos_video_key ON videos(video_key);

-- Full-Text Search indexes (GIN)
CREATE INDEX IF NOT EXISTS idx_videos_fts ON videos USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_videos_fts_no_caption ON videos USING GIN(fts_no_caption);

-- Usage profiles - mỗi profile gắn với một Google Sheet chứa danh sách Google Docs đã sử dụng
CREATE TABLE IF NOT EXISTS usage_profiles (
    id BIGSERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    name TEXT NOT NULL,
    google_sheet_url TEXT NOT NULL,
    tab_scope TEXT NOT NULL DEFAULT 'current',
    last_sync_at TIMESTAMPTZ,
    sync_status TEXT NOT NULL DEFAULT 'idle',
    sync_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_used_videos (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL REFERENCES usage_profiles(id) ON DELETE CASCADE,
    video_key TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    thumbnail TEXT,
    occurrences JSONB NOT NULL DEFAULT '[]'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_id, video_key)
);

CREATE TABLE IF NOT EXISTS usage_user_settings (
    user_email TEXT PRIMARY KEY,
    active_profile_id BIGINT REFERENCES usage_profiles(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_profiles_user_email ON usage_profiles(user_email);
CREATE INDEX IF NOT EXISTS idx_profile_used_videos_profile_id ON profile_used_videos(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_used_videos_video_key ON profile_used_videos(video_key);
CREATE INDEX IF NOT EXISTS idx_profile_used_videos_url ON profile_used_videos(url);
