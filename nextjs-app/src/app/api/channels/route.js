import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';

export async function GET() {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // 1. Ưu tiên đọc từ View 'unique_channels' (Giải pháp cho dữ liệu vô hạn)
        // View này phải được tạo bằng SQL trong Supabase Dashboard
        const { data: viewData, error: viewError } = await supabase
            .from('unique_channels')
            .select('channel_name');
        
        if (!viewError && viewData) {
            return NextResponse.json(viewData.map(v => v.channel_name));
        }

        // 2. Fallback: Nếu chưa tạo View, dùng cách cũ nhưng giới hạn cao hơn
        // CẢNH BÁO: Với dữ liệu cực lớn, bạn BẮT BUỘC phải dùng View ở trên để tránh treo server.
        console.warn('⚠️ View "unique_channels" chưa được tạo. Đang dùng fallback với giới hạn 10k.');
        const { data, error } = await supabase
            .from('videos')
            .select('channel_name')
            .not('channel_name', 'is', null)
            .limit(10000); 

        if (error) throw error;

        const channelSet = new Set();
        for (const r of (data || [])) {
            channelSet.add(r.channel_name);
        }
        
        const channels = Array.from(channelSet).sort();
        return NextResponse.json(channels);
    } catch (e) {
        console.error(`❌ Error fetching channels: ${e}`);
        return NextResponse.json([]);
    }
}
