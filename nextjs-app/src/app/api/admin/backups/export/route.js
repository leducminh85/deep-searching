import { NextResponse } from 'next/server';
import { createAdminBackupNdjsonStream } from '../../../../../lib/adminBackups';
import { requireAdmin } from '../../../../../lib/adminAuth';

export async function GET() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const stream = createAdminBackupNdjsonStream();
        const filename = `deep-video-search-backup-${new Date().toISOString().slice(0, 10)}.jsonl`;

        return new Response(stream, {
            headers: {
                'Cache-Control': 'no-store',
                'Content-Type': 'application/x-ndjson; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (err) {
        console.error('Admin backup export failed:', err);
        return NextResponse.json({ error: err.message || 'Cannot create backup file' }, { status: 500 });
    }
}
