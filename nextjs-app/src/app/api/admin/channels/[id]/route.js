import { NextResponse } from 'next/server';
import { deleteChannelAndVideos, getAdminChannel, updateAdminChannelStatus, updateAdminChannelVisibility } from '../../../../../lib/adminDb';
import { requireAdmin } from '../../../../../lib/adminAuth';
import { startChannelSync } from '../../../../../lib/youtubeChannelSync';

export async function PATCH(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const body = await request.json();
        let channel = null;

        if (Object.prototype.hasOwnProperty.call(body, 'hidden')) {
            channel = await updateAdminChannelVisibility(id, body.hidden);
        }

        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
            channel = await updateAdminChannelStatus(id, body.status);
        }

        if (!channel) {
            return NextResponse.json({ error: 'Khong tim thay kenh' }, { status: 404 });
        }

        return NextResponse.json({ channel });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Khong the cap nhat kenh' }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const channel = await getAdminChannel(id);

        if (!channel) {
            return NextResponse.json({ error: 'Khong tim thay kenh' }, { status: 404 });
        }

        const started = startChannelSync(channel, channel.channel_url);
        return NextResponse.json({
            channel,
            message: started ? 'Da bat dau fetch lai kenh' : 'Kenh nay dang duoc fetch',
        }, { status: started ? 202 : 200 });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Khong the fetch kenh' }, { status: 500 });
    }
}

export async function DELETE(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const result = await deleteChannelAndVideos(id);

        if (!result) {
            return NextResponse.json({ error: 'Khong tim thay kenh' }, { status: 404 });
        }

        return NextResponse.json({
            channel: result.channel,
            deleted_videos: result.deletedVideos,
        });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Khong the xoa kenh' }, { status: 500 });
    }
}
