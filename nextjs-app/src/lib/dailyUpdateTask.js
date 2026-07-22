import { spawn } from 'node:child_process';
import path from 'node:path';
import { getPool } from './localDb';
import { listAdminChannels } from './adminDb';
import { syncChannelVideos } from './youtubeChannelSync';

const MAX_LOGS = 1200;
const DEFAULT_ANALYSIS_LIMIT = 10000;
const DEFAULT_ANALYSIS_BATCH_SIZE = 100;
const DEFAULT_CHANNEL_SYNC_CONCURRENCY = 4;

function createInitialState() {
    return {
        running: false,
        status: 'idle',
        phase: 'idle',
        startedAt: null,
        finishedAt: null,
        error: null,
        progress: {
            percent: 0,
            label: 'Chưa chạy',
            channelsDone: 0,
            channelsTotal: 0,
            videosAdded: 0,
            videosUpdated: 0,
            videosSkipped: 0,
            analysisDone: 0,
            analysisTotal: 0,
        },
        logs: [],
        nextLogId: 1,
        promise: null,
    };
}

const globalState = globalThis.__wevicDailyUpdateTask || createInitialState();
globalThis.__wevicDailyUpdateTask = globalState;

function addLog(level, message) {
    const entry = {
        id: globalState.nextLogId++,
        at: new Date().toISOString(),
        level,
        message: String(message || ''),
    };
    globalState.logs.push(entry);
    if (globalState.logs.length > MAX_LOGS) {
        globalState.logs.splice(0, globalState.logs.length - MAX_LOGS);
    }
    return entry;
}

function setProgress(patch) {
    globalState.progress = { ...globalState.progress, ...patch };
}

function resetState() {
    const fresh = createInitialState();
    for (const key of Object.keys(fresh)) {
        if (key !== 'nextLogId') globalState[key] = fresh[key];
    }
    globalState.logs = [];
}

function publicStatus(sinceLogId = 0) {
    const since = Number(sinceLogId || 0);
    return {
        running: globalState.running,
        status: globalState.status,
        phase: globalState.phase,
        started_at: globalState.startedAt,
        finished_at: globalState.finishedAt,
        error: globalState.error,
        progress: globalState.progress,
        logs: globalState.logs.filter((entry) => entry.id > since),
        last_log_id: globalState.logs.at(-1)?.id || since,
    };
}

function isErrorMarker(text) {
    const marker = String(text || '').trim().toUpperCase();
    return marker === 'ERROR'
        || marker === 'ERROR_AI'
        || marker === 'ABORTED'
        || marker === 'IP_BLOCKED'
        || marker.startsWith('ERROR_')
        || marker.startsWith('ERROR:');
}

function isBadSummary(summary) {
    if (summary === null || summary === undefined) return true;
    const text = String(summary).trim();
    if (!text) return true;
    if (text === '#') return true;
    if (isErrorMarker(text)) return true;

    const lower = text.toLowerCase();
    const refusalMarkers = [
        "i can't fulfill this request",
        'i cannot fulfill this request',
        "i can't assist",
        'i cannot assist',
        "i can't provide",
        'i cannot provide',
    ];
    if (refusalMarkers.some((marker) => lower.includes(marker))) return true;

    return text.split(/\s+/).filter(Boolean).length < 25;
}

function needsAnalysis(row) {
    return isBadSummary(row.summary);
}

async function ensureAnalysisMetadataSchema() {
    const db = getPool();
    await db.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_model TEXT`);
    await db.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_version TEXT`);
    await db.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_updated_at TIMESTAMPTZ`);
}

async function countAnalysisCandidates() {
    const db = getPool();
    const result = await db.query(`
        SELECT COUNT(*)::INT AS total
        FROM videos
        WHERE url ~* 'youtube\\.com|youtu\\.be'
          AND (
              summary IS NULL
              OR btrim(summary) = ''
              OR btrim(summary) = '#'
              OR upper(btrim(summary)) IN ('ERROR', 'ERROR_AI', 'ABORTED', 'IP_BLOCKED')
              OR upper(btrim(summary)) LIKE 'ERROR:%'
          )
    `);
    return result.rows[0]?.total || 0;
}

async function getAnalysisBatch(seenIds, size) {
    const db = getPool();
    const seen = Array.from(seenIds);
    const result = await db.query(`
        SELECT id, title, url, channel_name, date_published, caption, summary
        FROM videos
        WHERE url ~* 'youtube\\.com|youtu\\.be'
          AND (cardinality($1::bigint[]) = 0 OR id <> ALL($1::bigint[]))
          AND (
              summary IS NULL
              OR btrim(summary) = ''
              OR btrim(summary) = '#'
              OR upper(btrim(summary)) IN ('ERROR', 'ERROR_AI', 'ABORTED', 'IP_BLOCKED')
              OR upper(btrim(summary)) LIKE 'ERROR:%'
          )
        ORDER BY id DESC
        LIMIT $2
    `, [seen, size]);

    return result.rows.filter(needsAnalysis);
}

async function updateVideoAnalysis(result) {
    if (!result?.id || result.status === 'aborted' || result.status === 'skipped') return;

    const updates = [];
    const params = [result.id];

    if (Object.prototype.hasOwnProperty.call(result, 'caption')) {
        params.push(result.caption);
        updates.push(`caption = $${params.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(result, 'summary')) {
        params.push(result.summary);
        updates.push(`summary = $${params.length}`);
    }

    if (result.status === 'done') {
        params.push(result.analysis_model || null);
        updates.push(`analysis_model = $${params.length}`);
        params.push(result.analysis_version || null);
        updates.push(`analysis_version = $${params.length}`);
        updates.push('analysis_updated_at = NOW()');
    } else if (result.status === 'no_caption' || result.status === 'error_ai') {
        updates.push('analysis_model = NULL');
        updates.push('analysis_version = NULL');
        updates.push('analysis_updated_at = NULL');
    }

    if (!updates.length) return;

    await ensureAnalysisMetadataSchema();
    const db = getPool();
    await db.query(`
        UPDATE videos
        SET ${updates.join(', ')}
        WHERE id = $1
    `, params);
}

function getPythonCommand() {
    return process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
}

function parseJsonPrefix(text) {
    const source = String(text || '').trimStart();
    if (!source.startsWith('{')) {
        throw new Error('Worker record does not start with JSON');
    }

    let inString = false;
    let escaped = false;
    let depth = 0;

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\' && inString) {
            escaped = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return {
                    payload: JSON.parse(source.slice(0, index + 1)),
                    rest: source.slice(index + 1),
                };
            }
        }
    }

    throw new Error('Incomplete worker JSON record');
}

function handleWorkerRecord(kind, payload, context) {
    if (kind === 'RESULT') {
        context.updateChain = context.updateChain
            .then(() => updateVideoAnalysis(payload))
            .then(() => {
                context.done += 1;
                const nextDone = globalState.progress.analysisDone + 1;
                setProgress({
                    analysisDone: nextDone,
                    percent: Math.min(99, Math.round(55 + (nextDone / Math.max(globalState.progress.analysisTotal, 1)) * 44)),
                    label: `Đã phân tích ${nextDone}/${globalState.progress.analysisTotal} video`,
                });
                if (payload.status === 'aborted') {
                    addLog('danger', `Dừng phân tích tại video ${payload.id}: ${payload.error || 'YouTube chặn IP'}`);
                }
            });
        return;
    }

    if (kind === 'LOG') {
        addLog(payload.level || 'info', payload.message || '');
    }
}

function parseWorkerLine(line, context) {
    let remaining = String(line || '').trim();
    if (!remaining) return;

    while (remaining) {
        const match = remaining.match(/^(RESULT|LOG)\t/);
        if (!match) {
            const nextTag = remaining.search(/(?:RESULT|LOG)\t/);
            if (nextTag === -1) {
                addLog('info', remaining);
                return;
            }

            const prefix = remaining.slice(0, nextTag).trim();
            if (prefix) addLog('info', prefix);
            remaining = remaining.slice(nextTag);
            continue;
        }

        const parsed = parseJsonPrefix(remaining.slice(match[0].length));
        handleWorkerRecord(match[1], parsed.payload, context);
        remaining = parsed.rest.trim();
    }
}

async function runAnalysisWorkerBatch(batch) {
    if (!batch.length) return 0;

    const scriptPath = path.join(process.cwd(), 'scripts', 'video-analysis-db-worker.py');
    const child = spawn(getPythonCommand(), [scriptPath], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });

    const context = { updateChain: Promise.resolve(), done: 0 };
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
            try {
                parseWorkerLine(line, context);
            } catch (err) {
                addLog('danger', `Không đọc được log phân tích: ${err.message}`);
            }
        }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() || '';
        for (const line of lines) {
            if (line.trim()) addLog('danger', line.trim());
        }
    });

    for (const item of batch) {
        child.stdin.write(`${JSON.stringify(item)}\n`);
    }
    child.stdin.end();

    const exitCode = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
    });

    if (stdoutBuffer.trim()) parseWorkerLine(stdoutBuffer, context);
    if (stderrBuffer.trim()) addLog('danger', stderrBuffer.trim());
    await context.updateChain;

    if (exitCode === 2) {
        throw new Error(
            'YouTube đang chặn tải caption (IP_BLOCKED/429). Hãy thêm cookies.txt vào nextjs-app/data, giảm DB_ANALYSIS_MAX_WORKERS, hoặc thử lại sau khi IP hết bị giới hạn.'
        );
    }

    if (exitCode !== 0) {
        throw new Error(`Python analysis worker exited with code ${exitCode}`);
    }

    return context.done;
}

async function runDatabaseAnalysis() {
    await ensureAnalysisMetadataSchema();
    const limit = Math.max(Number(process.env.DAILY_ANALYSIS_LIMIT || DEFAULT_ANALYSIS_LIMIT), 1);
    const batchSize = Math.max(Number(process.env.DAILY_ANALYSIS_BATCH_SIZE || DEFAULT_ANALYSIS_BATCH_SIZE), 1);
    const estimatedTotal = Math.min(await countAnalysisCandidates(), limit);
    const seenIds = new Set();

    setProgress({
        analysisDone: 0,
        analysisTotal: estimatedTotal,
        label: estimatedTotal ? `Chuẩn bị phân tích ${estimatedTotal} video` : 'Không có video cần phân tích',
        percent: 55,
    });

    addLog('info', estimatedTotal
        ? `Tìm thấy khoảng ${estimatedTotal} video cần caption/summary.`
        : 'Không có video nào cần phân tích.');

    while (seenIds.size < limit) {
        const batch = await getAnalysisBatch(seenIds, Math.min(batchSize, limit - seenIds.size));
        if (!batch.length) break;
        batch.forEach((row) => seenIds.add(Number(row.id)));
        addLog('info', `Bắt đầu batch phân tích ${batch.length} video.`);
        await runAnalysisWorkerBatch(batch);
    }
}

async function runChannelSyncQueue(channels) {
    const concurrency = Math.max(Number(process.env.DAILY_CHANNEL_SYNC_CONCURRENCY || DEFAULT_CHANNEL_SYNC_CONCURRENCY), 1);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < channels.length) {
            const channel = channels[nextIndex++];
            const url = channel.channel_url || channel.source_channel_url;
            addLog('info', `Đồng bộ video: ${channel.channel_name}`);
            try {
                const result = await syncChannelVideos(channel, url, { minDurationSeconds: 180 });
                setProgress({
                    videosAdded: globalState.progress.videosAdded + Number(result.added || 0),
                    videosUpdated: globalState.progress.videosUpdated + Number(result.updated || 0),
                    videosSkipped: globalState.progress.videosSkipped + Number(result.skippedShorts || 0),
                });
                addLog('success', `${channel.channel_name}: ${result.imported} video hợp lệ, +${result.added} mới, ${result.updated} cập nhật, bỏ qua ${result.skippedShorts} video ngắn.`);
            } catch (err) {
                addLog('danger', `${channel.channel_name}: ${err.message || 'Đồng bộ lỗi'}`);
            }

            const channelsDone = globalState.progress.channelsDone + 1;
            setProgress({
                channelsDone,
                percent: Math.round(5 + (channelsDone / Math.max(channels.length, 1)) * 50),
                label: `Đã đồng bộ ${channelsDone}/${channels.length} kênh`,
            });
        }
    }

    addLog('info', `Sync kênh chạy ${Math.min(concurrency, channels.length)} luồng song song.`);
    await Promise.all(Array.from(
        { length: Math.min(concurrency, channels.length) },
        () => worker()
    ));
}

async function runDailyUpdate() {
    globalState.running = true;
    globalState.status = 'running';
    globalState.phase = 'sync';
    globalState.startedAt = new Date().toISOString();
    globalState.finishedAt = null;
    globalState.error = null;
    setProgress({ percent: 1, label: 'Đang tải danh sách kênh' });
    addLog('info', 'Bắt đầu cập nhật hằng ngày bằng database.');

    try {
        const channels = (await listAdminChannels()).filter((channel) => channel.channel_url || channel.source_channel_url);
        setProgress({
            channelsTotal: channels.length,
            channelsDone: 0,
            label: `Chuẩn bị đồng bộ ${channels.length} kênh`,
            percent: 2,
        });
        addLog('info', `Tìm thấy ${channels.length} kênh có URL trong database.`);

        await runChannelSyncQueue(channels);

        globalState.phase = 'analysis';
        setProgress({ label: 'Đang phân tích caption/summary từ database', percent: 55 });
        await runDatabaseAnalysis();

        globalState.status = 'completed';
        globalState.phase = 'completed';
        globalState.finishedAt = new Date().toISOString();
        setProgress({ percent: 100, label: 'Hoàn tất cập nhật hằng ngày' });
        addLog('success', 'Hoàn tất cập nhật hằng ngày.');
    } catch (err) {
        globalState.status = 'failed';
        globalState.phase = 'failed';
        globalState.error = err.message || 'Daily update failed';
        globalState.finishedAt = new Date().toISOString();
        setProgress({ label: globalState.error });
        addLog('danger', globalState.error);
    } finally {
        globalState.running = false;
        globalState.promise = null;
    }
}

export function getDailyUpdateStatus(sinceLogId = 0) {
    return publicStatus(sinceLogId);
}

export function startDailyUpdateTask() {
    if (globalState.running) {
        return { started: false, status: publicStatus() };
    }

    resetState();
    globalState.promise = runDailyUpdate();
    globalState.promise.catch(() => {});
    return { started: true, status: publicStatus() };
}
