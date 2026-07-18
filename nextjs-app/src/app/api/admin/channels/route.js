import { NextResponse } from 'next/server';
import { findExistingAdminChannelByUrl, listAdminChannels, upsertAdminChannel } from '../../../../lib/adminDb';
import { requireAdmin } from '../../../../lib/adminAuth';
import { startChannelSync } from '../../../../lib/youtubeChannelSync';

export async function GET() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        return NextResponse.json({ channels: await listAdminChannels() });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể tải danh sách kênh' }, { status: 500 });
    }
}

export async function POST(request) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const body = await request.json();
        const channelUrl = String(body.channel_url || body.channelUrl || '').trim();
        const channelName = String(body.channel_name || body.channelName || channelUrl).trim();

        if (!channelUrl) {
            return NextResponse.json({ error: 'Vui lòng nhập URL kênh YouTube' }, { status: 400 });
        }

        const existingChannel = await findExistingAdminChannelByUrl(channelUrl);
        if (existingChannel) {
            return NextResponse.json({
                error: 'Kênh đã tồn tại',
                channel: existingChannel,
            }, { status: 409 });
        }

        const channel = await upsertAdminChannel({
            channelName,
            channelUrl,
            status: body.status,
        });

        startChannelSync(channel, channelUrl);

        return NextResponse.json({
            channel,
            message: 'Đã thêm kênh',
        }, { status: 202 });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể thêm kênh' }, { status: 500 });
    }
}
