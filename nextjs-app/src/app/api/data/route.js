import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';
import { queryVideos } from '../../../lib/localDb';

let _cachedData = null;

export async function GET(request) {
    try {
        // Auth vẫn dùng Supabase
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

        // Query video data từ LOCAL PostgreSQL
        const [data, total, errorInfo] = await getDataInternal(
            query, page, pageSize, sortBy, sortOrder, 
            mode, minViews, maxViews, startDate, endDate, channels, captionSearch
        );

        if (errorInfo) {
            return NextResponse.json({ detail: errorInfo, data: [], total: 0 }, { status: 500 });
        }

        const response = NextResponse.json({ data, total, page, page_size: pageSize });

        // Ghi log lịch sử tìm kiếm vẫn dùng Supabase
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
        const keywords = query.split(',').map(k => k.trim()).filter(k => k);

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

export async function getDataInternal(query, page, pageSize, sortBy, sortOrder, mode, minViews, maxViews, startDate, endDate, channels, captionSearch) {
    // Dùng LOCAL PostgreSQL cho video data
    return await queryVideos({
        query,
        page,
        pageSize,
        sortBy,
        sortOrder,
        mode,
        minViews,
        maxViews,
        startDate,
        endDate,
        channels,
        captionSearch,
    });
}