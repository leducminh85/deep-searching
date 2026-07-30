import { NextResponse } from 'next/server';
import { listQueuedAdminChannels } from '../../../../../lib/adminDb';
import { requireAdmin } from '../../../../../lib/adminAuth';

export async function GET() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        return NextResponse.json({ queue: await listQueuedAdminChannels() });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể tải danh sách chờ' }, { status: 500 });
    }
}
