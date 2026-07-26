import { NextResponse } from 'next/server';
import { ensureAdminSchema } from '../../../../lib/adminDb';
import { countUserAccounts } from '../../../../lib/adminUsers';
import { requireAdmin } from '../../../../lib/adminAuth';
import { getDailyUpdateStatus } from '../../../../lib/dailyUpdateTask';
import { getPool } from '../../../../lib/localDb';

async function checkOllama() {
    const baseUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);

    try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
            signal: controller.signal,
            cache: 'no-store',
        });
        return { ok: response.ok, label: response.ok ? 'Kết nối được' : 'Không phản hồi đúng' };
    } catch {
        return { ok: false, label: 'Chưa kết nối' };
    } finally {
        clearTimeout(timer);
    }
}

function compactDailyStatus(status) {
    const logs = Array.isArray(status?.logs) ? status.logs : [];
    const lastLog = logs[logs.length - 1];

    return {
        running: Boolean(status?.running),
        status: status?.status || (status?.running ? 'running' : 'idle'),
        phase: status?.phase || 'idle',
        startedAt: status?.started_at || status?.startedAt || null,
        finishedAt: status?.finished_at || status?.finishedAt || null,
        error: status?.error || null,
        progress: status?.progress || null,
        lastLog: lastLog?.message || null,
    };
}

export async function GET() {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    try {
        await ensureAdminSchema();
        const db = getPool();
        const [totalsResult, accountCount, ollama] = await Promise.all([
            db.query(`
                SELECT
                    (SELECT COUNT(*)::int FROM channel_sources) AS channels,
                    (SELECT COUNT(*)::int FROM videos) AS videos,
                    (SELECT COUNT(*)::int FROM videos WHERE summary IS NOT NULL AND btrim(summary) <> '') AS analyzed_videos,
                    (SELECT COUNT(*)::int FROM videos WHERE summary IS NULL OR btrim(summary) = '') AS pending_videos
            `),
            countUserAccounts().catch(() => 0),
            checkOllama(),
        ]);
        const totals = totalsResult.rows[0] || {};

        return NextResponse.json({
            totals: {
                channels: totals.channels || 0,
                videos: totals.videos || 0,
                analyzedVideos: totals.analyzed_videos || 0,
                pendingVideos: totals.pending_videos || 0,
                accounts: accountCount,
            },
            dailyUpdate: compactDailyStatus(getDailyUpdateStatus(0)),
            environment: {
                worker: { ok: true, label: 'Sẵn sàng' },
                ollama,
            },
        });
    } catch (err) {
        return NextResponse.json({ error: err.message || 'Không thể tải thống kê dashboard' }, { status: 500 });
    }
}
