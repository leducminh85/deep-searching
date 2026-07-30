import { NextResponse } from 'next/server';
import { deleteQueuedAdminChannel } from '../../../../../../lib/adminDb';
import { requireAdmin } from '../../../../../../lib/adminAuth';

export async function DELETE(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const queuedChannel = await deleteQueuedAdminChannel(id);
        if (!queuedChannel) {
            return NextResponse.json({ error: 'Không tìm thấy kênh trong danh sách chờ' }, { status: 404 });
        }

        return NextResponse.json({
            queued_channel: queuedChannel,
            message: 'Đã xóa kênh khỏi danh sách chờ',
        });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể xóa kênh khỏi danh sách chờ' }, { status: 500 });
    }
}
