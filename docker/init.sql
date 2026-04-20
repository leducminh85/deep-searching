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

-- Full-Text Search indexes (GIN)
CREATE INDEX IF NOT EXISTS idx_videos_fts ON videos USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_videos_fts_no_caption ON videos USING GIN(fts_no_caption);
