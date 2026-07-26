import { NextResponse } from 'next/server';
import { importAdminBackup } from '../../../../../lib/adminBackups';
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
                return NextResponse.json({ error: 'Vui lòng upload file JSON backup' }, { status: 400 });
            }
            payload = JSON.parse(await file.text());
        } else {
            payload = await request.json();
        }

        const result = await importAdminBackup(payload);
        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể import backup' }, { status: 400 });
    }
}
