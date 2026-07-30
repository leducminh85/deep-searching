import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { markChannelSyncState } from './adminDb';
import { getPool } from './localDb';

const DEFAULT_ANALYSIS_LIMIT = 10000;
const DEFAULT_ANALYSIS_BATCH_SIZE = 100;

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
    if (!text || text === '#') return true;
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

function badSummarySql() {
    return `
        (
            summary IS NULL
            OR btrim(summary) = ''
            OR btrim(summary) = '#'
            OR upper(btrim(summary)) IN ('ERROR', 'ERROR_AI', 'ABORTED', 'IP_BLOCKED')
            OR upper(btrim(summary)) LIKE 'ERROR:%'
        )
    `;
}

async function countChannelAnalysisCandidates(channelName) {
    const db = getPool();
    const result = await db.query(`
        SELECT COUNT(*)::INT AS total
        FROM videos
        WHERE url ~* 'youtube\\.com|youtu\\.be'
          AND lower(btrim(channel_name)) = lower(btrim($1))
          AND ${badSummarySql()}
    `, [channelName]);
    return result.rows[0]?.total || 0;
}

async function getChannelAnalysisBatch(channelName, seenIds, size) {
    const db = getPool();
    const seen = Array.from(seenIds);
    const result = await db.query(`
        SELECT id, title, url, channel_name, date_published, caption, summary
        FROM videos
        WHERE url ~* 'youtube\\.com|youtu\\.be'
          AND lower(btrim(channel_name)) = lower(btrim($1))
          AND (cardinality($2::bigint[]) = 0 OR id <> ALL($2::bigint[]))
          AND ${badSummarySql()}
        ORDER BY id DESC
        LIMIT $3
    `, [channelName, seen, size]);

    return result.rows.filter(needsAnalysis);
}

async function updateVideoAnalysis(result) {
    result = hydrateWorkerPayload(result);
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

function readAndDeleteWorkerPayload(filePath) {
    const resolved = path.resolve(String(filePath || ''));
    const text = fs.readFileSync(resolved, 'utf8');
    fs.rmSync(resolved, { force: true });
    return text;
}

function hydrateWorkerPayload(result) {
    if (!result || typeof result !== 'object') return result;
    const hydrated = { ...result };

    for (const field of ['caption', 'summary']) {
        const fileKey = `${field}_file`;
        if (hydrated[fileKey] && !Object.prototype.hasOwnProperty.call(hydrated, field)) {
            hydrated[field] = readAndDeleteWorkerPayload(hydrated[fileKey]);
        }
        delete hydrated[fileKey];
    }

    return hydrated;
}

function isFinalAnalysisResult(result) {
    return result?.status !== 'caption_fetched';
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
                if (isFinalAnalysisResult(payload)) context.done += 1;
            });
        return;
    }

    if (kind === 'LOG') {
        context.onLog(payload.level || 'info', payload.message || '');
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
                addWorkerFallbackLog(context, remaining);
                return;
            }

            const prefix = remaining.slice(0, nextTag).trim();
            if (prefix) addWorkerFallbackLog(context, prefix);
            remaining = remaining.slice(nextTag);
            continue;
        }

        const parsed = parseJsonPrefix(remaining.slice(match[0].length));
        handleWorkerRecord(match[1], parsed.payload, context);
        remaining = parsed.rest.trim();
    }
}

function addWorkerFallbackLog(context, text) {
    const value = String(text || '').trim();
    if (!value) return;

    if (/"(?:caption|summary|caption_file|summary_file)"\s*:/.test(value)) {
        context.onLog('warning', 'Worker emitted an incomplete analysis payload; raw caption/summary was hidden.');
        return;
    }

    context.onLog('info', value.length > 500 ? `${value.slice(0, 500)}...` : value);
}

async function runAnalysisWorkerBatch(batch, { onLog }) {
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

    const context = { updateChain: Promise.resolve(), done: 0, onLog };
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
                onLog('danger', `Không đọc được log phân tích: ${err.message}`);
            }
        }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() || '';
        for (const line of lines) {
            if (line.trim()) onLog('danger', line.trim());
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
    if (stderrBuffer.trim()) onLog('danger', stderrBuffer.trim());
    await context.updateChain;

    if (exitCode === 2) {
        throw new Error('YouTube đang chặn tải caption (IP_BLOCKED/429). Hãy thêm cookies.txt vào nextjs-app/data hoặc thử lại sau.');
    }

    if (exitCode !== 0) {
        throw new Error(`Python analysis worker exited with code ${exitCode}`);
    }

    return context.done;
}

export async function analyzeVideosForChannel(channelRow, options = {}) {
    const channelName = String(channelRow?.channel_name || channelRow?.channelName || '').trim();
    if (!channelName) return { total: 0, analyzed: 0 };

    const onLog = options.onLog || ((level, message) => {
        console.log(`[channel-analysis:${level}] ${message}`);
    });
    const limit = Math.max(Number(options.limit || process.env.CHANNEL_ANALYSIS_LIMIT || DEFAULT_ANALYSIS_LIMIT), 1);
    const batchSize = Math.max(Number(options.batchSize || process.env.CHANNEL_ANALYSIS_BATCH_SIZE || DEFAULT_ANALYSIS_BATCH_SIZE), 1);
    const channelId = channelRow?.id;

    await ensureAnalysisMetadataSchema();
    if (channelId) {
        await markChannelSyncState(channelId, {
            analysis_status: 'running',
            last_error: null,
        });
    }

    try {
        const total = Math.min(await countChannelAnalysisCandidates(channelName), limit);
        const seenIds = new Set();
        let analyzed = 0;

        onLog('info', total
            ? `Tìm thấy ${total} video cần phân tích cho kênh ${channelName}.`
            : `Không có video cần phân tích cho kênh ${channelName}.`);

        while (seenIds.size < limit) {
            const batch = await getChannelAnalysisBatch(channelName, seenIds, Math.min(batchSize, limit - seenIds.size));
            if (!batch.length) break;

            batch.forEach((row) => seenIds.add(Number(row.id)));
            onLog('info', `Bắt đầu phân tích ${batch.length} video của kênh ${channelName}.`);
            analyzed += await runAnalysisWorkerBatch(batch, { onLog });
        }

        if (channelId) {
            await markChannelSyncState(channelId, {
                analysis_status: 'completed',
                last_analysis_at: new Date(),
                last_error: `Fetched and analyzed channel videos (${analyzed}/${total}).`,
            });
        }

        return { total, analyzed };
    } catch (err) {
        if (channelId) {
            await markChannelSyncState(channelId, {
                analysis_status: 'failed',
                last_error: err.message || 'Channel analysis failed',
            });
        }
        throw err;
    }
}
