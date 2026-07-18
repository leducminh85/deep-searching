import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/adminAuth';
import { getDailyUpdateStatus, startDailyUpdateTask } from '../../../../lib/dailyUpdateTask';

export const runtime = 'nodejs';

export async function GET(request) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { searchParams } = new URL(request.url);
    return NextResponse.json(getDailyUpdateStatus(searchParams.get('since_log_id') || 0));
}

export async function POST() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const result = startDailyUpdateTask();
    return NextResponse.json({
        started: result.started,
        ...result.status,
    }, { status: result.started ? 202 : 200 });
}
