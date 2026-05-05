/**
 * Local PostgreSQL Database Module
 * 
 * Handles video data queries using a local PostgreSQL database.
 * Auth, search_history, and channel_sources remain on Supabase.
 */
import pg from 'pg';
const { Pool } = pg;

let pool = null;

function getPool() {
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
} = {}) {
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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderClause = `ORDER BY ${dbSortColumn} ${isDescending ? 'DESC' : 'ASC'} NULLS LAST`;

    try {
        // Count query
        const countSql = `SELECT COUNT(*) as total FROM videos ${whereClause}`;
        const countResult = await db.query(countSql, params);
        const totalCount = parseInt(countResult.rows[0].total, 10);

        // Data query
        const dataSql = `
            SELECT title, url, channel_name, views, date_published, thumbnail, created_at, summary
            FROM videos
            ${whereClause}
            ${orderClause}
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        const dataParams = [...params, pageSize, offset];

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


