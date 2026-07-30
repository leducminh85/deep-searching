import { NextResponse } from 'next/server';
import { enqueueAdminChannel, findExistingAdminChannelByUrl, listAdminChannels } from '../../../../lib/adminDb';
import { requireAdmin } from '../../../../lib/adminAuth';

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
                error: 'Kênh đã tồn tại trong DB',
                channel: existingChannel,
            }, { status: 409 });
        }

        const queuedChannel = await enqueueAdminChannel({
            channelName,
            channelUrl,
            status: body.status,
        });

        return NextResponse.json({
            queued_channel: queuedChannel,
            message: queuedChannel?.inserted ? 'Đã thêm kênh vào danh sách chờ' : 'Kênh đã có trong danh sách chờ',
        }, { status: queuedChannel?.inserted ? 201 : 200 });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể thêm kênh vào danh sách chờ' }, { status: 500 });
    }
}
