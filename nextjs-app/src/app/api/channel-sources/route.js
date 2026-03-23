import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';

export async function POST(request) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { channel_url, note } = await request.json();

        if (!channel_url) {
            return NextResponse.json({ error: 'Channel URL is required' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('channel_sources')
            .insert([
                { channel_url, note }
            ])
            .select();

        if (error) {
            throw error;
        }

        return NextResponse.json({ success: true, data });
    } catch (e) {
        console.error(`❌ Error adding channel source: ${e}`);
        return NextResponse.json({ error: e.message || 'Failed to add channel source' }, { status: 500 });
    }
}
