import { NextResponse } from 'next/server';
import { promoteQueuedAdminChannel } from '../../../../../../../lib/adminDb';
import { requireAdmin } from '../../../../../../../lib/adminAuth';
import { analyzeVideosForChannel } from '../../../../../../../lib/videoAnalysisRunner';
import { startChannelSync } from '../../../../../../../lib/youtubeChannelSync';

export async function POST(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const result = await promoteQueuedAdminChannel(id);
        if (!result) {
            return NextResponse.json({ error: 'Không tìm thấy kênh trong danh sách chờ' }, { status: 404 });
        }

        const rawUrl = result.channel.channel_url || result.channel.source_channel_url || result.queued.channel_url;
        const started = startChannelSync(result.channel, rawUrl, {
            afterSync: async ({ result: syncResult }) => {
                const channelName = syncResult?.channel?.channelName || result.channel.channel_name;
                await analyzeVideosForChannel({
                    id: result.channel.id,
                    channel_name: channelName,
                });
            },
        });

        return NextResponse.json({
            channel: result.channel,
            already_exists: result.alreadyExists,
            started,
            message: result.alreadyExists
                ? (started ? 'Kênh đã có trong DB, đã bắt đầu cập nhật và phân tích lại' : 'Kênh đã có trong DB và đang được cập nhật')
                : (started ? 'Đã đưa kênh vào DB, bắt đầu cập nhật và phân tích' : 'Đã đưa kênh vào DB, kênh đang được cập nhật'),
        }, { status: started ? 202 : 200 });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể cập nhật kênh từ danh sách chờ' }, { status: 500 });
    }
}
