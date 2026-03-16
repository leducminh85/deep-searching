import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase';

// Global cache for data (only small subset)
let _cachedData = null;

export async function GET(request) {
    try {
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

        const [data, total] = await getDataInternal(query, page, pageSize, sortBy, sortOrder, mode, minViews, maxViews, startDate, endDate, channels);
        return NextResponse.json({
            data,
            total,
            page,
            page_size: pageSize
        });
    } catch (e) {
        return NextResponse.json({ detail: e.message }, { status: 500 });
    }
}

async function getDataInternal(query, page, pageSize, sortBy, sortOrder, mode, minViews, maxViews, startDate, endDate, channels) {
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
        console.log('⚠️ Supabase chưa được cấu hình.');
        return [[], 0];
    }

    try {
        let builder = supabase
            .from('videos')
            .select('title,url,channel_name,views,date_published,thumbnail,caption,summary,created_at', { count: 'exact' });

        // 1. Xử lý tìm kiếm từ khóa
        let keywords = [];
        if (query) {
            if (query.includes(',')) {
                keywords = query.split(',').map(k => k.trim()).filter(k => k);
            } else {
                keywords = query.split(' ').map(k => k.trim()).filter(k => k);
            }

            if (keywords.length > 0) {
                const searchFields = ['title', 'summary', 'caption', 'channel_name'];
                if (mode === 'and') {
                    for (const kw of keywords) {
                        const pattern = `%${kw}%`;
                        builder = builder.or(searchFields.map(f => `${f}.ilike.${pattern}`).join(','));
                    }
                } else {
                    const orConds = [];
                    for (const kw of keywords) {
                        const pattern = `%${kw}%`;
                        for (const f of searchFields) {
                            orConds.push(`${f}.ilike.${pattern}`);
                        }
                    }
                    if (orConds.length > 0) {
                        builder = builder.or(orConds.join(','));
                    }
                }
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

        let response;
        try {
            response = await builder
                .order(dbSortColumn, { ascending: !isDescending })
                .range(start, end);
            
            if (response.error) throw response.error;
        } catch (e) {
            console.error('❌ Data API Error:', e);
            // Fallback nếu search timeout (giữ nguyên logic cũ: fallback về title/channel_name)
            const errorMsg = String(e.message || e).toLowerCase();
            const errorCode = e.code ? String(e.code) : '';
            if (query && (errorMsg.includes('57014') || errorCode === '57014' || errorMsg.includes('timeout'))) {
                console.log('⚠️ Search timeout detected. Fallback to Title/Channel only...');
                builder = supabase
                    .from('videos')
                    .select('title,url,channel_name,views,date_published,thumbnail,caption,summary,created_at', { count: 'exact' });

                // Áp dụng lại các filter nâng cao
                if (minViews !== null) builder = builder.gte('views', minViews);
                if (maxViews !== null) builder = builder.lte('views', maxViews);
                if (startDate) builder = builder.gte('date_published', startDate);
                if (endDate) builder = builder.lte('date_published', endDate);
                if (channels) {
                    const chanList = channels.split(',').map(c => c.trim()).filter(c => c);
                    if (chanList.length > 0) builder = builder.in('channel_name', chanList);
                }

                const limitF = ['title', 'channel_name'];
                if (mode === 'and') {
                    for (const kw of keywords) {
                        const pattern = `%${kw}%`;
                        builder = builder.or(limitF.map(f => `${f}.ilike.${pattern}`).join(','));
                    }
                } else {
                    const orC = [];
                    for (const kw of keywords) {
                        const pattern = `%${kw}%`;
                        for (const f of limitF) orC.push(`${f}.ilike.${pattern}`);
                    }
                    if (orC.length > 0) builder = builder.or(orC.join(','));
                }
                response = await builder
                    .order(dbSortColumn, { ascending: !isDescending })
                    .range(start, end);
                
                if (response.error) throw response.error;
            } else {
                throw e;
            }
        }

        const records = response.data || [];
        const totalCount = response.count !== null && response.count !== undefined ? response.count : 0;
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
            _cachedData = [formatted, totalCount];
        }
        return [formatted, totalCount];
    } catch (e) {
        console.error(`❌ Database error: ${e}`);
        return [[], 0];
    }
}
