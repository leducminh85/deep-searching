import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';

// Global cache for data (only small subset)
let _cachedData = null;

export async function GET(request) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q') || null;
        const page = parseInt(searchParams.get('page') || '1', 10);
        const pageSize = parseInt(searchParams.get('size') || '200', 10);
        const sortBy = searchParams.get('sort') || 'Created At';
        const sortOrder = searchParams.get('order') || 'desc';
        const mode = searchParams.get('mode') || 'or';
        const minViews = searchParams.get('min_views') ? parseInt(searchParams.get('min_views'), 10) : null;
        const maxViews = searchParams.get('max_views') ? parseInt(searchParams.get('max_views'), 10) : null;
        const startDate = searchParams.get('start_date') || null;
        const endDate = searchParams.get('end_date') || null;
        const channels = searchParams.get('channels') || null;
        const captionSearchParam = searchParams.get('caption_search');
        const captionSearch = captionSearchParam === null || captionSearchParam === '1';

        const [data, total, errorInfo] = await getDataInternal(supabase, query, page, pageSize, sortBy, sortOrder, mode, minViews, maxViews, startDate, endDate, channels, captionSearch);
        if (errorInfo) {
            return NextResponse.json({ detail: errorInfo, data: [], total: 0 }, { status: 500 });
        }
        const response = NextResponse.json({
            data,
            total,
            page,
            page_size: pageSize
        });

        // Background logging for search history (don't await to keep response fast)
        if (page === 1 && query && query.trim()) {
            logSearchHistory(supabase, query, mode, total, user?.email);
        }

        return response;
    } catch (e) {
        return NextResponse.json({ detail: e.message }, { status: 500 });
    }
}

async function logSearchHistory(supabase, query, mode, totalCount, email) {
    if (!supabase) return;
    try {
        let keywords = [];
        if (query.includes(',')) {
            keywords = query.split(',').map(k => k.trim()).filter(k => k);
        } else {
            keywords = query.split(' ').map(k => k.trim()).filter(k => k);
        }

        await supabase
            .from('search_history')
            .insert([{
                full_query: query,
                keywords: keywords,
                search_mode: mode,
                results_count: totalCount,
                user_email: email
            }]);
    } catch (err) {
        console.error('❌ Failed to log search history:', err);
    }
}

async function getDataInternal(supabase, query, page, pageSize, sortBy, sortOrder, mode, minViews, maxViews, startDate, endDate, channels, captionSearch) {
    const columnMap = {
        'title': 'title', 'url': 'url', 'link': 'url', 'views': 'views',
        'date_published': 'date_published', 'date published': 'date_published',
        'channel_name': 'channel_name', 'channel name': 'channel_name',
        'created_at': 'created_at', 'created at': 'created_at',
        'thumbnail': 'thumbnail', 'caption': 'caption', 'summary': 'summary'
    };
    const normalizedSort = String(sortBy).toLowerCase().trim();
    const dbSortColumn = columnMap[normalizedSort] || 'created_at';
    const isDescending = String(sortOrder).toLowerCase() === 'desc';
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;

    // Chỉ dùng cache nếu KHÔNG có bất kỳ bộ lọc nào
    const hasFilters = !!(query || minViews !== null || maxViews !== null || startDate || endDate || channels);
    if (!hasFilters && page === 1 && dbSortColumn === 'created_at' && isDescending && _cachedData !== null) {
        return _cachedData;
    }

    if (!supabase) {
        return [[], 0, "Supabase environment variables (SUPABASE_URL, SUPABASE_KEY) are missing in production settings."];
    }

    try {
        let builder = supabase
            .from('videos')
            .select('title,url,channel_name,views,date_published,thumbnail,caption,summary,created_at', { count: 'exact' });

        // 1. Xử lý tìm kiếm từ khóa bằng Full-Text Search (FTS)
        if (query) {
            let keywords = [];
            if (query.includes(',')) {
                keywords = query.split(',').map(k => k.trim()).filter(k => k);
            } else {
                keywords = query.split(' ').map(k => k.trim()).filter(k => k);
            }

            if (keywords.length > 0) {
                // Nối các keyword bằng & (AND) hoặc | (OR) tùy theo mode
                const separator = mode === 'and' ? ' & ' : ' | ';
                const ftsQuery = keywords.join(separator);
                // Chọn cột FTS dựa trên chế độ caption search
                const ftsColumn = captionSearch ? 'fts' : 'fts_no_caption';
                builder = builder.textSearch(ftsColumn, ftsQuery, { type: 'plain', config: 'simple' });
            }
        }

        // 2. Xử lý bộ lọc nâng cao
        if (minViews !== null) {
            builder = builder.gte('views', minViews);
        }
        if (maxViews !== null) {
            builder = builder.lte('views', maxViews);
        }
        if (startDate) {
            builder = builder.gte('date_published', startDate);
        }
        if (endDate) {
            builder = builder.lte('date_published', endDate);
        }
        if (channels) {
            const channelList = channels.split(',').map(c => c.trim()).filter(c => c);
            if (channelList.length > 0) {
                builder = builder.in('channel_name', channelList);
            }
        }

        // 3. Thực thi query với sort + pagination
        const { data, count, error } = await builder
            .order(dbSortColumn, { ascending: !isDescending })
            .range(start, end);

        if (error) {
            throw error;
        }

        const records = data || [];
        const totalCount = count !== null && count !== undefined ? count : 0;
        const formatted = records.map(r => ({
            'Title': r.title || '',
            'URL': r.url || '',
            'Channel Name': r.channel_name || '',
            'Views': r.views || 0,
            'Date Published': r.date_published || '',
            'Thumbnail': r.thumbnail || '',
            'Caption': r.caption || '',
            'Summary': r.summary || ''
        }));

        if (!hasFilters && page === 1 && dbSortColumn === 'created_at' && isDescending) {
            _cachedData = [formatted, totalCount, null];
        }
        return [formatted, totalCount, null];
    } catch (e) {
        console.error(`❌ Database error: ${e}`);
        return [[], 0, String(e.message || e)];
    }
}
