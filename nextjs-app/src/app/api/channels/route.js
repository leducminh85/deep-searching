import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';
import { getChannels } from '../../../lib/localDb';

export async function GET() {
    // Auth vẫn dùng Supabase
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Lấy danh sách kênh từ LOCAL PostgreSQL
        const channels = await getChannels();
        return NextResponse.json(channels);
    } catch (e) {
        console.error(`❌ Error fetching channels: ${e}`);
        return NextResponse.json([]);
    }
}
