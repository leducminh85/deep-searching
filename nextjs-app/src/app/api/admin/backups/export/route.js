import { NextResponse } from 'next/server';
import { createAdminBackupNdjsonStream } from '../../../../../lib/adminBackups';
import { requireAdmin } from '../../../../../lib/adminAuth';
import { assertR2BackupReady, uploadBackupStreamToR2 } from '../../../../../lib/r2Backups';

export const runtime = 'nodejs';

function createBackupFilename() {
    const timestamp = new Date().toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
        .replace(/[:]/g, '-');
    return `deep-video-search-backup-${timestamp}.jsonl`;
}

export async function GET() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const backupStream = createAdminBackupNdjsonStream();
        const filename = createBackupFilename();
        let responseStream = backupStream;

        try {
            if (assertR2BackupReady()) {
                const [downloadStream, r2Stream] = backupStream.tee();
                responseStream = downloadStream;
                uploadBackupStreamToR2(r2Stream, 'latest.jsonl')
                    .then((result) => {
                        if (result?.uploaded) {
                            console.info(`Admin backup uploaded to R2: ${result.bucket}/${result.key}`);
                        }
                    })
                    .catch((err) => {
                        console.error('Admin backup R2 upload failed:', err);
                    });
            }
        } catch (err) {
            console.error('Admin backup R2 upload skipped:', err);
        }

        return new Response(responseStream, {
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
