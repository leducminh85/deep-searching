import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { getPool } from './localDb';

const CHANNEL_STATUSES = new Set(['normal', 'copyright']);
const CHANNEL_LIST_SHEET = 'Channel Lisitng';
let workbookChannelCache = null;
let adminSchemaPromise = null;

export function normalizeChannelStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    return CHANNEL_STATUSES.has(value) ? value : 'normal';
}

export async function ensureAdminSchema() {
    if (adminSchemaPromise) return adminSchemaPromise;

    adminSchemaPromise = ensureAdminSchemaInternal().catch((err) => {
        adminSchemaPromise = null;
        throw err;
    });
    return adminSchemaPromise;
}

async function ensureAdminSchemaInternal() {
    const db = getPool();

    await db.query(`
        CREATE TABLE IF NOT EXISTS channel_sources (
            id BIGSERIAL PRIMARY KEY,
            channel_id TEXT UNIQUE,
            channel_name TEXT NOT NULL,
            channel_url TEXT,
            source_channel_url TEXT,
            channel_thumbnail TEXT,
            status TEXT NOT NULL DEFAULT 'normal',
            hidden BOOLEAN NOT NULL DEFAULT FALSE,
            sync_status TEXT NOT NULL DEFAULT 'idle',
            analysis_status TEXT NOT NULL DEFAULT 'idle',
            last_sync_at TIMESTAMPTZ,
            last_analysis_at TIMESTAMPTZ,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS channel_id TEXT UNIQUE`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS channel_url TEXT`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS source_channel_url TEXT`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS channel_thumbnail TEXT`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'normal'`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'idle'`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS analysis_status TEXT NOT NULL DEFAULT 'idle'`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS last_analysis_at TIMESTAMPTZ`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS last_error TEXT`);
    await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_channel_sources_status ON channel_sources(status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_channel_sources_channel_name ON channel_sources(channel_name)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_channel_sources_source_url ON channel_sources(source_channel_url)`);
    await db.query(`
        UPDATE channel_sources
        SET channel_name = btrim(channel_name)
        WHERE channel_name <> btrim(channel_name)
    `);
    await db.query(`
        UPDATE channel_sources
        SET source_channel_url = channel_url
        WHERE source_channel_url IS NULL
          AND channel_url ~* 'youtube\\.com|youtu\\.be'
    `);
    await db.query(`
        DELETE FROM channel_sources cs
        USING (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY lower(source_channel_url)
                       ORDER BY has_thumbnail DESC, video_count DESC, updated_at DESC, id DESC
                   ) AS rn
            FROM (
                SELECT cs_inner.id,
                       cs_inner.source_channel_url,
                       cs_inner.updated_at,
                       (cs_inner.channel_thumbnail IS NOT NULL AND cs_inner.channel_thumbnail <> '') AS has_thumbnail,
                       COUNT(v.id) AS video_count
                FROM channel_sources cs_inner
                LEFT JOIN videos v ON lower(btrim(v.channel_name)) = lower(btrim(cs_inner.channel_name))
                WHERE cs_inner.source_channel_url IS NOT NULL
                GROUP BY cs_inner.id
            ) ranked
        ) d
        WHERE cs.id = d.id
          AND d.rn > 1
    `);
    await db.query(`
        UPDATE channel_sources sourced
        SET
            status = CASE WHEN old.status = 'copyright' THEN old.status ELSE sourced.status END,
            hidden = sourced.hidden OR old.hidden,
            updated_at = GREATEST(sourced.updated_at, old.updated_at)
        FROM channel_sources old
        WHERE sourced.source_channel_url IS NOT NULL
          AND old.source_channel_url IS NULL
          AND sourced.id <> old.id
          AND lower(btrim(sourced.channel_name)) = lower(btrim(old.channel_name))
    `);
    await db.query(`
        DELETE FROM channel_sources old
        USING channel_sources sourced
        WHERE sourced.source_channel_url IS NOT NULL
          AND old.source_channel_url IS NULL
          AND sourced.id <> old.id
          AND lower(btrim(sourced.channel_name)) = lower(btrim(old.channel_name))
    `);

    await db.query(`
        INSERT INTO channel_sources (channel_name, status, sync_status, analysis_status)
        SELECT DISTINCT btrim(v.channel_name), 'normal', 'idle', 'idle'
        FROM videos v
        LEFT JOIN channel_sources cs ON lower(btrim(cs.channel_name)) = lower(btrim(v.channel_name))
        WHERE v.channel_name IS NOT NULL
          AND btrim(v.channel_name) <> ''
          AND cs.id IS NULL
        ON CONFLICT DO NOTHING
    `);
}

function normalizeHeader(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function findWorkbookPath() {
    const candidates = [
        path.resolve(process.cwd(), 'data.xlsx'),
        path.resolve(process.cwd(), '..', 'data.xlsx'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function readWorkbookChannels() {
    const workbookPath = findWorkbookPath();
    if (!workbookPath) return [];
    const stat = fs.statSync(workbookPath);
    if (workbookChannelCache?.path === workbookPath && workbookChannelCache?.mtimeMs === stat.mtimeMs) {
        return workbookChannelCache.channels;
    }

    const workbook = XLSX.read(fs.readFileSync(workbookPath), { type: 'buffer', sheetRows: 1000 });
    const sheet = workbook.Sheets[CHANNEL_LIST_SHEET];
    if (!sheet) return [];

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const header = rows[0] || [];
    const columnMap = new Map(header.map((cell, index) => [normalizeHeader(cell), index]));
    const urlIndex = columnMap.get('link kenh');
    const nameIndex = columnMap.get('ten kenh');

    if (urlIndex === undefined) return [];

    const seen = new Set();
    const channels = rows.slice(1)
        .map((row) => ({
            channelUrl: String(row[urlIndex] || '').trim(),
            channelName: String(nameIndex !== undefined ? row[nameIndex] || '' : '').trim(),
        }))
        .filter((row) => {
            if (!row.channelUrl || !/youtube\.com|youtu\.be/i.test(row.channelUrl)) return false;
            const key = row.channelUrl.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    workbookChannelCache = { path: workbookPath, mtimeMs: stat.mtimeMs, channels };
    return channels;
}

export async function syncWorkbookChannels() {
    await ensureAdminSchema();
    const channels = readWorkbookChannels();
    if (!channels.length) return { imported: 0 };

    const db = getPool();
    let imported = 0;

    for (const channel of channels) {
        const fallbackName = channel.channelName || channel.channelUrl;
        const update = await db.query(`
            UPDATE channel_sources
            SET
                channel_url = COALESCE(channel_sources.channel_url, $2),
                source_channel_url = COALESCE(channel_sources.source_channel_url, $2),
                updated_at = CASE WHEN channel_sources.channel_url IS NULL THEN NOW() ELSE channel_sources.updated_at END
            WHERE lower(source_channel_url) = lower($2)
               OR lower(btrim(channel_name)) = lower(btrim($1))
               OR lower(channel_url) = lower($2)
            RETURNING id
        `, [fallbackName, channel.channelUrl]);
        if (update.rowCount > 0) imported += 1;
        else {
            await db.query(`
                INSERT INTO channel_sources (channel_name, channel_url, source_channel_url, status, sync_status, analysis_status, updated_at)
                VALUES ($1, $2, $2, 'normal', 'idle', 'idle', NOW())
            `, [fallbackName, channel.channelUrl]);
            imported += 1;
        }
    }

    return { imported };
}

export async function listAdminChannels() {
    await ensureAdminSchema();
    const db = getPool();
    const result = await db.query(`
        SELECT
            cs.id,
            cs.channel_id,
            cs.channel_name,
            cs.channel_url,
            cs.source_channel_url,
            cs.channel_thumbnail,
            cs.status,
            cs.hidden,
            cs.sync_status,
            cs.analysis_status,
            cs.last_sync_at,
            cs.last_analysis_at,
            cs.last_error,
            cs.created_at,
            cs.updated_at,
            COUNT(v.id)::INT AS video_count,
            COUNT(v.id) FILTER (WHERE NULLIF(v.summary, '') IS NULL)::INT AS pending_analysis_count
        FROM channel_sources cs
        LEFT JOIN videos v ON lower(btrim(v.channel_name)) = lower(btrim(cs.channel_name))
        GROUP BY cs.id
        ORDER BY cs.updated_at DESC, cs.channel_name ASC
    `);
    return result.rows;
}

export async function getAdminChannel(id) {
    await ensureAdminSchema();
    const db = getPool();
    const result = await db.query(`SELECT * FROM channel_sources WHERE id = $1`, [id]);
    return result.rows[0] || null;
}

export async function upsertAdminChannel({ channelId = null, channelName, channelUrl = null, channelThumbnail = null, status = 'normal' }) {
    await ensureAdminSchema();
    const db = getPool();
    const normalizedStatus = normalizeChannelStatus(status);
    const normalizedName = String(channelName || channelUrl || '').trim();
    const result = await db.query(`
        INSERT INTO channel_sources (channel_id, channel_name, channel_url, source_channel_url, channel_thumbnail, status, sync_status, analysis_status, updated_at)
        VALUES ($1, $2, $3, $3, $4, $5, 'queued', 'pending', NOW())
        ON CONFLICT (channel_id)
        DO UPDATE SET
            channel_name = EXCLUDED.channel_name,
            channel_url = COALESCE(EXCLUDED.channel_url, channel_sources.channel_url),
            source_channel_url = COALESCE(channel_sources.source_channel_url, EXCLUDED.source_channel_url),
            channel_thumbnail = COALESCE(EXCLUDED.channel_thumbnail, channel_sources.channel_thumbnail),
            status = EXCLUDED.status,
            sync_status = 'queued',
            analysis_status = 'pending',
            last_error = NULL,
            updated_at = NOW()
        RETURNING *
    `, [channelId, normalizedName, channelUrl, channelThumbnail, normalizedStatus]);

    if (result.rows[0]) return result.rows[0];

    const fallback = await db.query(`
        INSERT INTO channel_sources (channel_name, channel_url, source_channel_url, channel_thumbnail, status, sync_status, analysis_status, updated_at)
        VALUES ($1, $2, $2, $3, $4, 'queued', 'pending', NOW())
        RETURNING *
    `, [normalizedName, channelUrl, channelThumbnail, normalizedStatus]);
    return fallback.rows[0];
}

export async function updateAdminChannelStatus(id, status) {
    await ensureAdminSchema();
    const db = getPool();
    const result = await db.query(`
        UPDATE channel_sources
        SET status = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [id, normalizeChannelStatus(status)]);
    return result.rows[0] || null;
}

export async function updateAdminChannelVisibility(id, hidden) {
    await ensureAdminSchema();
    const db = getPool();
    const result = await db.query(`
        UPDATE channel_sources
        SET hidden = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [id, Boolean(hidden)]);
    return result.rows[0] || null;
}

export async function updateAdminChannelUrl(id, channelUrl) {
    await ensureAdminSchema();
    const db = getPool();
    const normalizedUrl = String(channelUrl || '').trim();
    if (!normalizedUrl) return null;

    const result = await db.query(`
        UPDATE channel_sources
        SET
            channel_url = $2,
            source_channel_url = $2,
            channel_id = NULL,
            channel_thumbnail = NULL,
            sync_status = 'queued',
            last_error = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
    `, [id, normalizedUrl]);
    return result.rows[0] || null;
}

export async function markChannelSyncState(id, fields) {
    await ensureAdminSchema();
    const db = getPool();
    const updates = [];
    const params = [id];

    for (const [key, value] of Object.entries(fields)) {
        if (!['channel_id', 'channel_name', 'channel_url', 'channel_thumbnail', 'sync_status', 'analysis_status', 'last_sync_at', 'last_analysis_at', 'last_error'].includes(key)) {
            continue;
        }
        params.push(key === 'channel_name' ? String(value || '').trim() : value);
        updates.push(`${key} = $${params.length}`);
    }

    if (!updates.length) return getAdminChannel(id);
    updates.push('updated_at = NOW()');

    const updateSql = `
        UPDATE channel_sources
        SET ${updates.join(', ')}
        WHERE id = $1
        RETURNING *
    `;

    if (fields.channel_id) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const duplicate = await client.query(`
                SELECT id
                FROM channel_sources
                WHERE lower(channel_id) = lower($1)
                  AND id <> $2
                LIMIT 1
                FOR UPDATE
            `, [fields.channel_id, id]);

            if (duplicate.rows[0]) {
                await client.query(`
                    UPDATE channel_sources target
                    SET
                        status = CASE WHEN duplicate.status = 'copyright' THEN 'copyright' ELSE target.status END,
                        hidden = target.hidden OR duplicate.hidden,
                        source_channel_url = COALESCE(target.source_channel_url, duplicate.source_channel_url),
                        created_at = LEAST(target.created_at, duplicate.created_at)
                    FROM channel_sources duplicate
                    WHERE target.id = $1
                      AND duplicate.id = $2
                `, [id, duplicate.rows[0].id]);
                await client.query(`DELETE FROM channel_sources WHERE id = $1`, [duplicate.rows[0].id]);
            }

            const result = await client.query(updateSql, params);
            await client.query('COMMIT');
            return result.rows[0] || null;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    const result = await db.query(updateSql, params);
    return result.rows[0] || null;
}

export async function insertOrUpdateVideos(videos) {
    if (!videos.length) return { added: 0, updated: 0 };

    const db = getPool();
    let added = 0;
    let updated = 0;

    for (const video of videos) {
        const result = await db.query(`
            INSERT INTO videos (title, url, channel_name, views, date_published, thumbnail, caption, summary, video_key)
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, ''), COALESCE($8, ''), $9)
            ON CONFLICT (url)
            DO UPDATE SET
                title = EXCLUDED.title,
                channel_name = EXCLUDED.channel_name,
                views = EXCLUDED.views,
                date_published = EXCLUDED.date_published,
                thumbnail = EXCLUDED.thumbnail,
                video_key = COALESCE(EXCLUDED.video_key, videos.video_key),
                created_at = videos.created_at
            RETURNING (xmax = 0) AS inserted
        `, [
            video.title,
            video.url,
            video.channelName,
            video.views || 0,
            video.datePublished || null,
            video.thumbnail || '',
            video.caption || '',
            video.summary || '',
            video.videoKey || null,
        ]);

        if (result.rows[0]?.inserted) added += 1;
        else updated += 1;
    }

    return { added, updated };
}

export async function deleteChannelAndVideos(id) {
    await ensureAdminSchema();
    const db = getPool();
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const channelResult = await client.query(`SELECT * FROM channel_sources WHERE id = $1 FOR UPDATE`, [id]);
        const channel = channelResult.rows[0];
        if (!channel) {
            await client.query('ROLLBACK');
            return null;
        }

        await client.query(`
            DELETE FROM profile_used_videos pu
            USING videos v
            WHERE lower(btrim(v.channel_name)) = lower(btrim($1))
              AND (pu.url = v.url OR pu.video_key = v.video_key)
        `, [channel.channel_name]);

        const deletedVideos = await client.query(`
            DELETE FROM videos
            WHERE lower(btrim(channel_name)) = lower(btrim($1))
        `, [channel.channel_name]);

        await client.query(`DELETE FROM channel_sources WHERE id = $1`, [id]);
        await client.query('COMMIT');

        return {
            channel,
            deletedVideos: deletedVideos.rowCount || 0,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function listChannelVideos(channelId, { page = 1, size = 25 } = {}) {
    await ensureAdminSchema();
    const channel = await getAdminChannel(channelId);
    if (!channel) return null;

    const db = getPool();
    const pageSize = Math.min(Math.max(Number(size) || 25, 1), 100);
    const pageNumber = Math.max(Number(page) || 1, 1);
    const offset = (pageNumber - 1) * pageSize;

    const countResult = await db.query(`
        SELECT COUNT(*)::INT AS total
        FROM videos
        WHERE lower(btrim(channel_name)) = lower(btrim($1))
    `, [channel.channel_name]);

    const videoResult = await db.query(`
        SELECT id, title, url, views, date_published, thumbnail, summary, video_key, created_at
        FROM videos
        WHERE lower(btrim(channel_name)) = lower(btrim($1))
        ORDER BY date_published DESC NULLS LAST, created_at DESC
        LIMIT $2 OFFSET $3
    `, [channel.channel_name, pageSize, offset]);

    return {
        channel,
        videos: videoResult.rows,
        total: countResult.rows[0]?.total || 0,
        page: pageNumber,
        size: pageSize,
    };
}
