import { NextResponse } from 'next/server';
import { listAdminChannels, syncWorkbookChannels } from '../../../../../lib/adminDb';
import { requireAdmin } from '../../../../../lib/adminAuth';
import { startMissingChannelMetadataSync } from '../../../../../lib/youtubeChannelSync';

export async function POST() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        const result = await syncWorkbookChannels();
        const channels = await listAdminChannels();
        const metadataJobs = startMissingChannelMetadataSync(channels);

        return NextResponse.json({
            imported: result.imported,
            metadata_jobs_started: metadataJobs,
            channels,
        });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể import kênh từ data.xlsx' }, { status: 500 });
    }
}
