import { ensureAdminSchema } from './adminDb';
import { getPool } from './localDb';

const CHANNEL_COLUMNS = [
    'id',
    'channel_id',
    'channel_name',
    'channel_url',
    'source_channel_url',
    'channel_thumbnail',
    'status',
    'hidden',
    'sync_status',
    'analysis_status',
    'last_sync_at',
    'last_analysis_at',
    'last_error',
    'created_at',
    'updated_at',
];

const VIDEO_COLUMNS = [
    'id',
    'title',
    'url',
    'channel_name',
    'views',
    'date_published',
    'thumbnail',
    'caption',
    'summary',
    'video_key',
    'created_at',
    'summary_v2_backup',
    'analysis_model',
    'analysis_version',
    'analysis_updated_at',
];

function quoteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function getRowColumns(row, whitelist) {
    return whitelist.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
}

async function filterExistingColumns(client, table, columns) {
    const result = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = ANY($2)
    `, [table, columns]);
    const existing = new Set(result.rows.map((row) => row.column_name));
    return columns.filter((column) => existing.has(column));
}

async function exportTable(client, table, columns) {
    const existingColumns = await filterExistingColumns(client, table, columns);
    if (!existingColumns.length) return [];
    const selected = existingColumns.map(quoteIdentifier).join(', ');
    const result = await client.query(`SELECT ${selected} FROM ${quoteIdentifier(table)} ORDER BY id ASC`);
    return result.rows;
}

async function upsertRows(client, table, rows, whitelist, preferredConflictColumns) {
    if (!Array.isArray(rows) || !rows.length) return 0;

    const existingColumns = await filterExistingColumns(client, table, whitelist);
    let imported = 0;

    for (const row of rows) {
        const columns = getRowColumns(row, existingColumns);
        if (!columns.length) continue;

        const values = columns.map((column) => row[column] ?? null);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const insertColumns = columns.map(quoteIdentifier).join(', ');
        const conflictColumn = preferredConflictColumns.find((column) => columns.includes(column) && row[column]);
        const target = quoteIdentifier(table);

        if (conflictColumn) {
            const updateColumns = columns.filter((column) => column !== conflictColumn && column !== 'id');
            const updateClause = updateColumns.length
                ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ')}`
                : 'DO NOTHING';

            await client.query(`
                INSERT INTO ${target} (${insertColumns})
                VALUES (${placeholders})
                ON CONFLICT (${quoteIdentifier(conflictColumn)}) ${updateClause}
            `, values);
        } else {
            await client.query(`
                INSERT INTO ${target} (${insertColumns})
                VALUES (${placeholders})
            `, values);
        }

        imported += 1;
    }

    return imported;
}

async function resetSequence(client, table, column) {
    await client.query(`
        SELECT setval(
            pg_get_serial_sequence($1, $2),
            GREATEST((SELECT COALESCE(MAX(${quoteIdentifier(column)}), 1) FROM ${quoteIdentifier(table)}), 1),
            true
        )
    `, [table, column]);
}

export async function createAdminBackup() {
    await ensureAdminSchema();
    const db = getPool();
    const [channels, videos] = await Promise.all([
        exportTable(db, 'channel_sources', CHANNEL_COLUMNS),
        exportTable(db, 'videos', VIDEO_COLUMNS),
    ]);

    return {
        version: 1,
        exported_at: new Date().toISOString(),
        source: 'deep-video-search-admin',
        counts: {
            channel_sources: channels.length,
            videos: videos.length,
        },
        data: {
            channel_sources: channels,
            videos,
        },
    };
}

export async function importAdminBackup(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('File backup không hợp lệ');
    }

    const data = payload.data || payload;
    const channels = data.channel_sources;
    const videos = data.videos;

    if (!Array.isArray(channels) && !Array.isArray(videos)) {
        throw new Error('File backup không có dữ liệu channel_sources hoặc videos');
    }

    await ensureAdminSchema();
    const db = getPool();
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const importedChannels = await upsertRows(client, 'channel_sources', channels || [], CHANNEL_COLUMNS, ['channel_id', 'id']);
        const importedVideos = await upsertRows(client, 'videos', videos || [], VIDEO_COLUMNS, ['url', 'id']);
        await resetSequence(client, 'channel_sources', 'id');
        await resetSequence(client, 'videos', 'id');
        await client.query('COMMIT');

        return {
            imported_channel_sources: importedChannels,
            imported_videos: importedVideos,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}
