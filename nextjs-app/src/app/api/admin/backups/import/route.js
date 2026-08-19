import { NextResponse } from 'next/server';
import { importAdminBackup, importAdminBackupNdjsonStream } from '../../../../../lib/adminBackups';
import { requireAdmin } from '../../../../../lib/adminAuth';

export async function POST(request) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const contentType = request.headers.get('content-type') || '';
        let payload;

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            const file = formData.get('file');
            if (!file || typeof file.text !== 'function') {
                return NextResponse.json({ error: 'Please upload a JSON backup file' }, { status: 400 });
            }
            const fileName = String(file.name || '').toLowerCase();
            if (fileName.endsWith('.jsonl') || fileName.endsWith('.ndjson') || file.type === 'application/x-ndjson') {
                const result = await importAdminBackupNdjsonStream(file.stream());
                return NextResponse.json(result);
            }
            payload = JSON.parse(await file.text());
        } else {
            payload = await request.json();
        }

        const result = await importAdminBackup(payload);
        return NextResponse.json(result);
    } catch (err) {
        console.error('Admin backup import failed:', err);
        return NextResponse.json({ error: err.message || 'Cannot import backup' }, { status: 400 });
    }
}
