import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/adminAuth';
import { getDailyUpdateStatus, startDailyUpdateTask, stopDailyUpdateTask } from '../../../../lib/dailyUpdateTask';

export const runtime = 'nodejs';

export async function GET(request) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { searchParams } = new URL(request.url);
    return NextResponse.json(getDailyUpdateStatus(searchParams.get('since_log_id') || 0));
}

export async function POST(request) {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    let body = {};
    try {
        body = await request.json();
    } catch {
        body = {};
    }

    if (body.action === 'stop') {
        const result = stopDailyUpdateTask();
        return NextResponse.json({
            stopped: result.stopped,
            ...result.status,
        }, { status: 200 });
    }

    const mode = body.mode === 'analysis' ? 'analysis' : 'all';
    const result = startDailyUpdateTask({ mode });
    return NextResponse.json({
        started: result.started,
        mode,
        ...result.status,
    }, { status: result.started ? 202 : 200 });
}
