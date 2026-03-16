import { NextResponse } from 'next/server';
import supabase from '../../../lib/supabase';

export async function GET() {
    if (!supabase) {
        return NextResponse.json([]);
    }
    try {
        const response = await supabase
            .from('videos')
            .select('channel_name');

        const channelSet = new Set();
        for (const r of (response.data || [])) {
            if (r.channel_name) {
                channelSet.add(r.channel_name);
            }
        }
        const channels = Array.from(channelSet).sort();
        return NextResponse.json(channels);
    } catch (e) {
        console.error(`❌ Error fetching channels: ${e}`);
        return NextResponse.json([]);
    }
}
