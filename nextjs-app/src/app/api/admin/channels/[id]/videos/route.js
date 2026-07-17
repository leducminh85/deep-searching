import { NextResponse } from 'next/server';
import { listChannelVideos } from '../../../../../../lib/adminDb';
import { requireAdmin } from '../../../../../../lib/adminAuth';

export async function GET(request, { params }) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const result = await listChannelVideos(id, {
            page: searchParams.get('page') || 1,
            size: searchParams.get('size') || 25,
        });

        if (!result) {
            return NextResponse.json({ error: 'Không tìm thấy kênh' }, { status: 404 });
        }

        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể tải video' }, { status: 500 });
    }
}
