/**
 * Local PostgreSQL Database Module
 * 
 * Handles video data queries using a local PostgreSQL database.
 * Auth, search_history, and channel_sources remain on Supabase.
 */
import pg from 'pg';
const { Pool } = pg;

let pool = null;
let usageSchemaPromise = null;

export function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/deep_searching',
        });
        pool.on('error', (err) => {
            console.error('❌ PostgreSQL pool error:', err);
        });
    }
    return pool;
}

export async function ensureUsageSchema() {
    if (!usageSchemaPromise) {
        usageSchemaPromise = (async () => {
            const db = getPool();

            await db.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_key TEXT`);

            await db.query(`
                UPDATE videos
                SET video_key = CASE
                    WHEN url ~* 'youtu\\.be/[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM 'youtu\\.be/([A-Za-z0-9_-]{11})')
                    WHEN url ~* '/shorts/[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM '/shorts/([A-Za-z0-9_-]{11})')
                    WHEN url ~* '/embed/[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM '/embed/([A-Za-z0-9_-]{11})')
                    WHEN url ~* '/v/[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM '/v/([A-Za-z0-9_-]{11})')
                    WHEN url ~* '[?&]v=[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM '[?&]v=([A-Za-z0-9_-]{11})')
                    ELSE 'url:' || lower(split_part(url, '#', 1))
                END
                WHERE video_key IS NULL OR video_key = ''
            `);

            await db.query(`CREATE INDEX IF NOT EXISTS idx_videos_video_key ON videos(video_key)`);

            await db.query(`
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
                )
            `);

            await db.query(`ALTER TABLE usage_profiles ADD COLUMN IF NOT EXISTS tab_scope TEXT NOT NULL DEFAULT 'current'`);

            await db.query(`
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
                )
            `);

            await db.query(`
                CREATE TABLE IF NOT EXISTS usage_user_settings (
                    user_email TEXT PRIMARY KEY,
                    active_profile_id BIGINT REFERENCES usage_profiles(id) ON DELETE SET NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);

            await db.query(`CREATE INDEX IF NOT EXISTS idx_usage_profiles_user_email ON usage_profiles(user_email)`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_used_videos_profile_id ON profile_used_videos(profile_id)`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_used_videos_video_key ON profile_used_videos(video_key)`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_used_videos_url ON profile_used_videos(url)`);
        })().catch((err) => {
            usageSchemaPromise = null;
            throw err;
        });
    }

    return usageSchemaPromise;
}

function appendUsedPredicate(params, profileId, userEmail) {
    const profileParam = params.length + 1;
    params.push(profileId);
    const emailParam = params.length + 1;
    params.push(userEmail);

    return `
        EXISTS (
            SELECT 1
            FROM profile_used_videos pu
            INNER JOIN usage_profiles up ON up.id = pu.profile_id
            WHERE pu.profile_id = $${profileParam}
              AND up.user_email = $${emailParam}
              AND (
                (videos.video_key IS NOT NULL AND pu.video_key = videos.video_key)
                OR pu.url = videos.url
              )
        )
    `;
}

/**
 * Query videos with search, pagination, sorting, and advanced filters.
 * Mirrors the Supabase query logic from the original /api/data/route.js
 */
export async function queryVideos({
    query = null,
    page = 1,
    pageSize = 50,
    sortBy = 'created_at',
    sortOrder = 'desc',
    mode = 'or',
    minViews = null,
    maxViews = null,
    startDate = null,
    endDate = null,
    channels = null,
    captionSearch = false,
    profileId = null,
    userEmail = null,
    hideUsed = false,
} = {}) {
    await ensureUsageSchema();
    const db = getPool();

    // Map sort column names
    const columnMap = {
        'title': 'title',
        'url': 'url',
        'views': 'views',
        'date published': 'date_published',
        'date_published': 'date_published',
        'channel name': 'channel_name',
        'channel_name': 'channel_name',
        'created_at': 'created_at',
        'created at': 'created_at',
        'thumbnail': 'thumbnail',
        'summary': 'summary',
    };

    const dbSortColumn = columnMap[String(sortBy).toLowerCase().trim()] || 'created_at';
    const isDescending = String(sortOrder).toLowerCase() === 'desc';
    const offset = (page - 1) * pageSize;

    // Build WHERE conditions
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // Full-Text Search
    if (query && query.trim()) {
        const ftsColumn = captionSearch ? 'fts' : 'fts_no_caption';
        const safeQuery = query.trim().replace(/[^\p{L}\p{N}\s,]/gu, '');
        const tags = safeQuery.split(',').map(t => t.trim()).filter(t => t);

        const tagQueries = tags.map(tag => {
            const words = tag.split(/\s+/).filter(w => w);
            if (words.length > 1) {
                return `(${words.join(' <-> ')})`;
            }
            return words[0];
        });

        if (tagQueries.length > 0) {
            const operator = mode === 'and' ? ' & ' : ' | ';
            const ftsQuery = tagQueries.join(operator);
            conditions.push(`${ftsColumn} @@ to_tsquery('simple', $${paramIndex})`);
            params.push(ftsQuery);
            paramIndex++;
        }
    }

    // Advanced filters
    if (minViews !== null) {
        conditions.push(`views >= $${paramIndex}`);
        params.push(minViews);
        paramIndex++;
    }
    if (maxViews !== null) {
        conditions.push(`views <= $${paramIndex}`);
        params.push(maxViews);
        paramIndex++;
    }
    if (startDate) {
        conditions.push(`date_published >= $${paramIndex}`);
        params.push(startDate);
        paramIndex++;
    }
    if (endDate) {
        conditions.push(`date_published <= $${paramIndex}`);
        params.push(endDate);
        paramIndex++;
    }
    if (channels) {
        const channelList = channels.split(',').map(c => c.trim()).filter(c => c);
        if (channelList.length > 0) {
            conditions.push(`channel_name = ANY($${paramIndex})`);
            params.push(channelList);
            paramIndex++;
        }
    }

    const orderClause = `ORDER BY ${dbSortColumn} ${isDescending ? 'DESC' : 'ASC'} NULLS LAST`;
    const canUseProfileFilter = Boolean(profileId && userEmail);

    try {
        // Count query
        const countParams = [...params];
        const countConditions = [...conditions];
        if (canUseProfileFilter && hideUsed) {
            countConditions.push(`NOT ${appendUsedPredicate(countParams, profileId, userEmail)}`);
        }
        const countWhereClause = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';
        const countSql = `SELECT COUNT(*) as total FROM videos ${countWhereClause}`;
        const countResult = await db.query(countSql, countParams);
        const totalCount = parseInt(countResult.rows[0].total, 10);

        // Data query
        const dataParams = [...params];
        const dataConditions = [...conditions];
        let usedSelect = `FALSE AS is_used`;

        if (canUseProfileFilter) {
            if (hideUsed) {
                dataConditions.push(`NOT ${appendUsedPredicate(dataParams, profileId, userEmail)}`);
            } else {
                usedSelect = `${appendUsedPredicate(dataParams, profileId, userEmail)} AS is_used`;
            }
        }

        const dataWhereClause = dataConditions.length > 0 ? `WHERE ${dataConditions.join(' AND ')}` : '';
        const limitParam = dataParams.length + 1;
        const offsetParam = dataParams.length + 2;

        const dataSql = `
            SELECT title, url, channel_name, views, date_published, thumbnail, created_at, summary, video_key, ${usedSelect}
            FROM videos
            ${dataWhereClause}
            ${orderClause}
            LIMIT $${limitParam} OFFSET $${offsetParam}
        `;
        dataParams.push(pageSize, offset);

        const dataResult = await db.query(dataSql, dataParams);

        const formatted = dataResult.rows.map(r => {
            return {
                'Title': r.title || '',
                'URL': r.url || '',
                'Channel Name': r.channel_name || '',
                'Views': r.views || 0,
                'Date Published': r.date_published || '',
                'Thumbnail': r.thumbnail || '',
                'Summary': r.summary || '',
                'Video Key': r.video_key || '',
                'Used': Boolean(r.is_used),
            };
        });

        return [formatted, totalCount, null];
    } catch (e) {
        console.error(`❌ Local DB Error: ${e.message}`);
        return [[], 0, e.message];
    }
}

/**
 * Get unique channel names from the local videos table.
 */
export async function getChannels() {
    const db = getPool();
    try {
        const result = await db.query(
            `SELECT DISTINCT channel_name FROM videos WHERE channel_name IS NOT NULL AND channel_name != '' ORDER BY channel_name`
        );
        return result.rows.map(r => r.channel_name);
    } catch (e) {
        console.error(`❌ Local DB Error (channels): ${e.message}`);
        return [];
    }
}

/**
 * Get search suggestions based on partial input.
 * Returns matching keywords (from FTS lexemes) and channel names.
 */
export async function getSuggestions(query) {
    const db = getPool();
    try {
        const lowerQuery = query.toLowerCase();
        const prefixPattern = `${lowerQuery}%`;

        // Only fetch keywords now
        const keywordResult = await db.query(
            `SELECT word, nentry 
             FROM ts_stat('SELECT fts_no_caption FROM videos') 
             WHERE word LIKE $1 AND length(word) >= 2
             ORDER BY nentry DESC 
             LIMIT 12`,
            [prefixPattern]
        );

        const suggestions = [];

        // Add keyword suggestions
        keywordResult.rows.forEach(r => {
            suggestions.push({
                text: r.word,
                type: 'keyword',
                count: r.nentry,
            });
        });

        return suggestions;
    } catch (e) {
        console.error(`❌ Local DB Error (suggestions): ${e.message}`);
        return [];
    }
}

/**
 * Preload the entire suggestion index for client-side filtering.
 * Returns all FTS lexemes (with counts).
 * Cached in server memory for 5 minutes to avoid repeated heavy queries.
 */
let _cachedIndex = null;
let _cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function preloadSuggestionIndex() {
    const now = Date.now();
    if (_cachedIndex && (now - _cacheTimestamp) < CACHE_TTL) {
        return _cachedIndex;
    }

    const db = getPool();
    try {
        const keywordResult = await db.query(
            `SELECT word, nentry 
             FROM ts_stat('SELECT fts_no_caption FROM videos') 
             WHERE length(word) >= 2
             ORDER BY nentry DESC 
             LIMIT 2000`
        );

        _cachedIndex = {
            keywords: keywordResult.rows.map(r => ({ text: r.word, count: r.nentry })),
        };
        _cacheTimestamp = now;

        return _cachedIndex;
    } catch (e) {
        console.error(`❌ Local DB Error (preload): ${e.message}`);
        return { keywords: [] };
    }
}


