import { NextResponse } from 'next/server';
import { listAdminChannels, upsertAdminChannel } from '../../../../lib/adminDb';
import { requireAdmin } from '../../../../lib/adminAuth';
import { startChannelSync } from '../../../../lib/youtubeChannelSync';

export async function GET() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        return NextResponse.json({ channels: await listAdminChannels() });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Khong the tai danh sach kenh' }, { status: 500 });
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
            return NextResponse.json({ error: 'Vui long nhap URL kenh YouTube' }, { status: 400 });
        }

        const channel = await upsertAdminChannel({
            channelName,
            channelUrl,
            status: body.status,
        });

        startChannelSync(channel, channelUrl);

        return NextResponse.json({
            channel,
            message: 'Da them kenh va bat dau fetch video nen',
        }, { status: 202 });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Khong the them kenh' }, { status: 500 });
    }
}
