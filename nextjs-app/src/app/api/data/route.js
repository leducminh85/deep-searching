import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';

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
        
        // GIỚI HẠN SIZE ĐỂ TRÁNH QUÁ TẢI (SIZE TỐI ĐA 100)
        const rawSize = parseInt(searchParams.get('size') || '20', 10);
        const pageSize = Math.min(rawSize, 100); 
        
        const sortBy = searchParams.get('sort') || 'Created At';
        const sortOrder = searchParams.get('order') || 'desc';
        const mode = searchParams.get('mode') || 'or';
        const minViews = searchParams.get('min_views') ? parseInt(searchParams.get('min_views'), 10) : null;
        const maxViews = searchParams.get('max_views') ? parseInt(searchParams.get('max_views'), 10) : null;
        const startDate = searchParams.get('start_date') || null;
        const endDate = searchParams.get('end_date') || null;
        const channels = searchParams.get('channels') || null;
        
        const captionSearchParam = searchParams.get('caption_search');
        const captionSearch = captionSearchParam === '1';

        const [data, total, errorInfo] = await getDataInternal(
            supabase, query, page, pageSize, sortBy, sortOrder, 
            mode, minViews, maxViews, startDate, endDate, channels, captionSearch
        );

        if (errorInfo) {
            return NextResponse.json({ detail: errorInfo, data: [], total: 0 }, { status: 500 });
        }

        const response = NextResponse.json({ data, total, page, page_size: pageSize });

        // Ghi log lịch sử tìm kiếm
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
        const keywords = query.includes(',') 
            ? query.split(',').map(k => k.trim()).filter(k => k)
            : query.split(' ').map(k => k.trim()).filter(k => k);

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

export async function getDataInternal(supabase, query, page, pageSize, sortBy, sortOrder, mode, minViews, maxViews, startDate, endDate, channels, captionSearch) {
    const columnMap = {
        'title': 'title',
        'url': 'url',
        'views': 'views',
        'date published': 'date_published',
        'date_published': 'date_published',
        'channel name': 'channel_name',
        'channel_name': 'channel_name',
        'created_at': 'created_at',
        'thumbnail': 'thumbnail',
        'summary': 'summary'
    };
    
    const dbSortColumn = columnMap[String(sortBy).toLowerCase().trim()] || 'created_at';
    const isDescending = String(sortOrder).toLowerCase() === 'desc';
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;

    try {
        const countOption = 'exact';
        
        // BỎ CAPTION ĐỂ TĂNG TỐC ĐỘ (CHỈ LẤY CÁC TRƯỜNG CẦN THIẾT)
        let builder = supabase
            .from('videos-ver1')
            .select('title,url,channel_name,views,date_published,thumbnail,created_at,summary', { count: countOption });

        // Xử lý tìm kiếm Full-Text
        if (query && query.trim()) {
            const ftsColumn = captionSearch ? 'fts' : 'fts_no_caption';
            const cleanQuery = query.trim();
const safeQuery = query.trim().replace(/[^\p{L}\p{N}\s,]/gu, '');
       
const terms = safeQuery.split(/[\s,]+/).filter(k => k);
            if (mode === 'and') {
            // Nối bằng '&' cho điều kiện AND
            const andQuery = terms.join(' & ');
            builder = builder.textSearch(ftsColumn, andQuery, { type: 'raw', config: 'simple' });
        } else {
            // Nối bằng '|' cho điều kiện OR
            const orQuery = terms.join(' | ');
            builder = builder.textSearch(ftsColumn, orQuery, { type: 'raw', config: 'simple' });
        }
        }

        // Áp dụng bộ lọc
        if (minViews !== null) builder = builder.gte('views', minViews);
        if (maxViews !== null) builder = builder.lte('views', maxViews);
        if (startDate) builder = builder.gte('date_published', startDate);
        if (endDate) builder = builder.lte('date_published', endDate);
        if (channels) {
            const list = channels.split(',').map(c => c.trim()).filter(c => c);
            if (list.length > 0) builder = builder.in('channel_name', list);
        }

        let data, count, error;

        // LUÔN ÁP DỤNG SORT ĐỂ KẾT QUẢ ĐỒNG NHẤT
        const result = await builder
            .order(dbSortColumn, { ascending: !isDescending })
            .range(start, end);
        
        data = result.data;
        count = result.count;
        error = result.error;

        if (error) throw error;

        const formatted = (data || []).map(r => ({
            'Title': r.title || '',
            'URL': r.url || '',
            'Channel Name': r.channel_name || '',
            'Views': r.views || 0,
            'Date Published': r.date_published || '',
            'Thumbnail': r.thumbnail || '',
            'Summary': r.summary || ''    
        }));

        const finalCount = (count === 0 && formatted.length > 0) ? 1000 : (count || 0);

        return [formatted, finalCount, null];
    } catch (e) {
        console.error(`❌ DB Error: ${e.message}`);
        return [[], 0, e.message];
    }
}