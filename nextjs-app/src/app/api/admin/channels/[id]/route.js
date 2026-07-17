import { NextResponse } from 'next/server';
import { deleteChannelAndVideos, getAdminChannel, updateAdminChannelStatus, updateAdminChannelUrl, updateAdminChannelVisibility } from '../../../../../lib/adminDb';
import { requireAdmin } from '../../../../../lib/adminAuth';
import { startChannelMetadataSync, startChannelSync } from '../../../../../lib/youtubeChannelSync';

export async function PATCH(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const body = await request.json();
        let channel = null;

        if (Object.prototype.hasOwnProperty.call(body, 'channel_url')) {
            const channelUrl = String(body.channel_url || '').trim();
            if (!channelUrl) {
                return NextResponse.json({ error: 'Vui lòng nhập URL kênh YouTube' }, { status: 400 });
            }
            channel = await updateAdminChannelUrl(id, channelUrl);
            if (channel) startChannelMetadataSync(channel);
        }

        if (Object.prototype.hasOwnProperty.call(body, 'hidden')) {
            channel = await updateAdminChannelVisibility(id, body.hidden);
        }

        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
            channel = await updateAdminChannelStatus(id, body.status);
        }

        if (!channel) {
            return NextResponse.json({ error: 'Không tìm thấy kênh' }, { status: 404 });
        }

        return NextResponse.json({ channel });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể cập nhật kênh' }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const channel = await getAdminChannel(id);

        if (!channel) {
            return NextResponse.json({ error: 'Không tìm thấy kênh' }, { status: 404 });
        }

        const started = startChannelSync(channel, channel.channel_url);
        return NextResponse.json({
            channel,
            message: started ? 'Đã bắt đầu fetch lại kênh' : 'Kênh này đang được fetch',
        }, { status: started ? 202 : 200 });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể fetch kênh' }, { status: 500 });
    }
}

export async function DELETE(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const result = await deleteChannelAndVideos(id);

        if (!result) {
            return NextResponse.json({ error: 'Không tìm thấy kênh' }, { status: 404 });
        }

        return NextResponse.json({
            channel: result.channel,
            deleted_videos: result.deletedVideos,
        });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể xóa kênh' }, { status: 500 });
    }
}
