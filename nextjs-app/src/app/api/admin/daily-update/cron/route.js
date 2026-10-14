import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { startDailyUpdateTask, stopDailyUpdateTask } from '../../../../../lib/dailyUpdateTask';

export const runtime = 'nodejs';

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function cronSecret() {
    return process.env.ADMIN_CRON_TOKEN || '';
}

function requestToken(request) {
    const authorization = request.headers.get('authorization') || '';
    if (authorization.toLowerCase().startsWith('bearer ')) {
        return authorization.slice('bearer '.length).trim();
    }
    return request.headers.get('x-admin-cron-token') || '';
}

export async function POST(request) {
    const expected = cronSecret();
    if (!expected) {
        return NextResponse.json({ error: 'ADMIN_CRON_TOKEN is not configured' }, { status: 500 });
    }

    if (!safeEqual(requestToken(request), expected)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body = {};
    try {
        body = await request.json();
    } catch {
        // Keep supporting existing cron callers without a request body.
    }

    const action = body?.action ?? 'start';
    if (action === 'stop') {
        const result = stopDailyUpdateTask();
        return NextResponse.json({
            triggered_by: 'cron',
            stopped: result.stopped,
            ...result.status,
        });
    }
    if (action !== 'start') {
        return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const result = startDailyUpdateTask();
    return NextResponse.json({
        triggered_by: 'cron',
        started: result.started,
        ...result.status,
    }, { status: result.started ? 202 : 200 });
}
