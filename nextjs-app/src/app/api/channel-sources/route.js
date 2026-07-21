import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';

function isMissingColumnError(error, columnName) {
    const text = [
        error?.message,
        error?.details,
        error?.hint,
        error?.code,
    ].filter(Boolean).join(' ').toLowerCase();

    return text.includes(columnName.toLowerCase())
        && (text.includes('column') || text.includes('schema cache') || text.includes('could not find'));
}

export async function POST(request) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { channel_url, note, reason, action_type } = await request.json();
        const actionType = String(action_type || 'add').trim().toLowerCase();
        const normalizedActionType = ['add', 'report'].includes(actionType) ? actionType : actionType.replace(/[^a-z0-9_-]/g, '');
        const channelUrl = String(channel_url || '').trim();
        const detail = String(reason || note || '').trim();

        if (!channelUrl) {
            return NextResponse.json({ error: 'Channel URL is required' }, { status: 400 });
        }

        if (normalizedActionType === 'report' && !detail) {
            return NextResponse.json({ error: 'Report reason is required' }, { status: 400 });
        }

        const payload = {
            channel_url: channelUrl,
            note: detail,
            action_type: normalizedActionType || 'add',
            user_email: user.email,
        };

        const { data, error } = await supabase
            .from('channel_sources')
            .insert([
                payload
            ])
            .select();

        if (error) {
            if (isMissingColumnError(error, 'user_email')) {
                return NextResponse.json({
                    error: 'Bảng Supabase channel_sources đang thiếu cột user_email. Hãy chạy SQL migration supabase/channel_sources_action_columns.sql rồi thử lại.'
                }, { status: 500 });
            }
            if (isMissingColumnError(error, 'action_type')) {
                return NextResponse.json({
                    error: 'Bảng Supabase channel_sources đang thiếu cột action_type. Hãy chạy SQL migration supabase/channel_sources_action_columns.sql rồi thử lại.'
                }, { status: 500 });
            }
            throw error;
        }

        return NextResponse.json({ success: true, data });
    } catch (e) {
        console.error(`❌ Error adding channel source: ${e}`);
        return NextResponse.json({ error: e.message || 'Failed to add channel source' }, { status: 500 });
    }
}
