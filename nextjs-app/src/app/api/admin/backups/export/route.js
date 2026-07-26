import { NextResponse } from 'next/server';
import { createAdminBackup } from '../../../../../lib/adminBackups';
import { requireAdmin } from '../../../../../lib/adminAuth';

export async function GET() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const backup = await createAdminBackup();
        const filename = `deep-video-search-backup-${new Date().toISOString().slice(0, 10)}.json`;

        return new NextResponse(JSON.stringify(backup, null, 2), {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể tạo file backup' }, { status: 500 });
    }
}
