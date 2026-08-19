import { ensureAdminSchema } from './adminDb';
import { exportUserAccounts, importUserAccounts } from './adminUsers';
import { ensureUsageSchema, getPool, resetLocalDbPool } from './localDb';

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

const CHANNEL_QUEUE_COLUMNS = [
    'id',
    'normalized_url',
    'channel_url',
    'channel_name',
    'status',
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

const USAGE_PROFILE_COLUMNS = [
    'id',
    'user_email',
    'name',
    'google_sheet_url',
    'tab_scope',
    'last_sync_at',
    'sync_status',
    'sync_error',
    'created_at',
    'updated_at',
];

const PROFILE_USED_VIDEO_COLUMNS = [
    'id',
    'profile_id',
    'video_key',
    'url',
    'title',
    'thumbnail',
    'occurrences',
    'first_seen_at',
    'last_seen_at',
];

const PROFILE_DOC_SYNC_COLUMNS = [
    'id',
    'profile_id',
    'doc_id',
    'doc_url',
    'title',
    'modified_time',
    'videos',
    'last_synced_at',
    'last_error',
    'updated_at',
];

const USAGE_USER_SETTING_COLUMNS = [
    'user_email',
    'active_profile_id',
    'updated_at',
];

const ADMIN_ACCOUNT_COLUMNS = [
    'id',
    'username',
    'password_hash',
    'role',
    'created_at',
    'updated_at',
];

const BACKUP_TABLES = [
    {
        key: 'admin_accounts',
        table: 'admin_accounts',
        columns: ADMIN_ACCOUNT_COLUMNS,
        conflicts: [['username'], ['id']],
        sequence: 'id',
    },
    {
        key: 'channel_sources',
        table: 'channel_sources',
        columns: CHANNEL_COLUMNS,
        conflicts: [['channel_id'], ['id']],
        sequence: 'id',
    },
    {
        key: 'channel_source_queue',
        table: 'channel_source_queue',
        columns: CHANNEL_QUEUE_COLUMNS,
        conflicts: [['normalized_url'], ['id']],
        sequence: 'id',
    },
    {
        key: 'videos',
        table: 'videos',
        columns: VIDEO_COLUMNS,
        conflicts: [['url'], ['id']],
        sequence: 'id',
    },
    {
        key: 'usage_profiles',
        table: 'usage_profiles',
        columns: USAGE_PROFILE_COLUMNS,
        conflicts: [['id']],
        sequence: 'id',
    },
    {
        key: 'profile_used_videos',
        table: 'profile_used_videos',
        columns: PROFILE_USED_VIDEO_COLUMNS,
        conflicts: [['profile_id', 'video_key'], ['id']],
        sequence: 'id',
    },
    {
        key: 'profile_doc_syncs',
        table: 'profile_doc_syncs',
        columns: PROFILE_DOC_SYNC_COLUMNS,
        conflicts: [['profile_id', 'doc_id'], ['id']],
        sequence: 'id',
    },
    {
        key: 'usage_user_settings',
        table: 'usage_user_settings',
        columns: USAGE_USER_SETTING_COLUMNS,
        conflicts: [['user_email']],
    },
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
    const orderColumn = existingColumns.includes('id') ? 'id' : existingColumns[0];
    const result = await client.query(`SELECT ${selected} FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(orderColumn)} ASC`);
    return result.rows;
}

async function countTable(client, table) {
    const result = await client.query(`SELECT COUNT(*)::INT AS total FROM ${quoteIdentifier(table)}`);
    return result.rows[0]?.total || 0;
}

async function* exportTableJsonRows(client, table, columns, batchSize = 500) {
    const existingColumns = await filterExistingColumns(client, table, columns);
    if (!existingColumns.length) return;

    const selected = existingColumns.map(quoteIdentifier).join(', ');
    const orderColumn = existingColumns.includes('id') ? 'id' : existingColumns[0];
    let offset = 0;
    let first = true;

    while (true) {
        const result = await client.query(
            `SELECT ${selected} FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(orderColumn)} ASC LIMIT $1 OFFSET $2`,
            [batchSize, offset]
        );
        if (!result.rows.length) break;

        for (const row of result.rows) {
            yield `${first ? '' : ','}\n${JSON.stringify(row)}`;
            first = false;
        }

        offset += result.rows.length;
        if (result.rows.length < batchSize) break;
    }
}

function getConflictColumns(row, columns, conflictTargets = []) {
    return conflictTargets.find((targetColumns) => (
        targetColumns.length > 0
        && targetColumns.every((column) => (
            columns.includes(column)
            && row[column] !== undefined
            && row[column] !== null
            && row[column] !== ''
        ))
    ));
}

async function upsertRows(client, table, rows, whitelist, conflictTargets) {
    if (!Array.isArray(rows) || !rows.length) return 0;

    const existingColumns = await filterExistingColumns(client, table, whitelist);
    let imported = 0;

    for (const row of rows) {
        const columns = getRowColumns(row, existingColumns);
        if (!columns.length) continue;

        const values = columns.map((column) => row[column] ?? null);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const insertColumns = columns.map(quoteIdentifier).join(', ');
        const conflictColumns = getConflictColumns(row, columns, conflictTargets);
        const target = quoteIdentifier(table);

        if (conflictColumns?.length) {
            const updateColumns = columns.filter((column) => !conflictColumns.includes(column) && column !== 'id');
            const updateClause = updateColumns.length
                ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ')}`
                : 'DO NOTHING';
            const conflictTarget = conflictColumns.map(quoteIdentifier).join(', ');

            await client.query(`
                INSERT INTO ${target} (${insertColumns})
                VALUES (${placeholders})
                ON CONFLICT (${conflictTarget}) ${updateClause}
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
    const existingColumns = await filterExistingColumns(client, table, [column]);
    if (!existingColumns.length) return;

    await client.query(`
        SELECT setval(
            pg_get_serial_sequence($1, $2),
            GREATEST((SELECT COALESCE(MAX(${quoteIdentifier(column)}), 1) FROM ${quoteIdentifier(table)}), 1),
            true
        )
    `, [table, column]);
}

function isTransientDbConnectionError(err) {
    return /connection terminated|connection closed|terminating connection|broken pipe|econnreset/i.test(String(err?.message || ''));
}

async function prepareBackupSchemasOnce() {
    await ensureAdminSchema();
    await ensureUsageSchema();
    const db = getPool();
    await db.query(`
        CREATE TABLE IF NOT EXISTS admin_accounts (
            id BIGSERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'admin',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_accounts_username ON admin_accounts(username)`);
}

async function prepareBackupSchemas() {
    try {
        await prepareBackupSchemasOnce();
    } catch (err) {
        if (!isTransientDbConnectionError(err)) throw err;
        await resetLocalDbPool();
        await prepareBackupSchemasOnce();
    }
}

export async function createAdminBackup() {
    await prepareBackupSchemas();
    const db = getPool();
    const tableEntries = await Promise.all(
        BACKUP_TABLES.map(async (config) => [config.key, await exportTable(db, config.table, config.columns)])
    );
    const tableData = Object.fromEntries(tableEntries);
    const authUsers = await exportUserAccounts()
        .then((users) => ({ users, error: null }))
        .catch((err) => ({ users: [], error: err.message || 'Unable to export Supabase Auth users' }));

    const data = {
        users: authUsers.users,
        ...tableData,
    };
    const counts = Object.fromEntries(
        Object.entries(data).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0])
    );

    return {
        version: 2,
        exported_at: new Date().toISOString(),
        source: 'deep-video-search-admin',
        notes: {
            supabase_auth: authUsers.error
                || 'Auth users are backed up without passwords or active sessions. Restored users receive generated passwords and should reset passwords.',
        },
        counts,
        data,
    };
}

async function* generateAdminBackupJson() {
    await prepareBackupSchemas();
    const db = getPool();
    const authUsers = await exportUserAccounts()
        .then((users) => ({ users, error: null }))
        .catch((err) => ({ users: [], error: err.message || 'Unable to export Supabase Auth users' }));
    const tableCounts = Object.fromEntries(
        await Promise.all(BACKUP_TABLES.map(async (config) => [config.key, await countTable(db, config.table)]))
    );
    const counts = {
        users: authUsers.users.length,
        ...tableCounts,
    };
    const notes = {
        supabase_auth: authUsers.error
            || 'Auth users are backed up without passwords or active sessions. Restored users receive generated passwords and should reset passwords.',
    };

    yield '{\n';
    yield `  "version": 2,\n`;
    yield `  "exported_at": ${JSON.stringify(new Date().toISOString())},\n`;
    yield `  "source": "deep-video-search-admin",\n`;
    yield `  "notes": ${JSON.stringify(notes)},\n`;
    yield `  "counts": ${JSON.stringify(counts)},\n`;
    yield '  "data": {\n';
    yield `    "users": ${JSON.stringify(authUsers.users)}`;

    for (const config of BACKUP_TABLES) {
        yield `,\n    ${JSON.stringify(config.key)}: [`;
        for await (const rowJson of exportTableJsonRows(db, config.table, config.columns)) {
            yield rowJson;
        }
        yield '\n    ]';
    }

    yield '\n  }\n';
    yield '}\n';
}

export function createAdminBackupStream() {
    const encoder = new TextEncoder();
    const iterator = generateAdminBackupJson();

    return new ReadableStream({
        async pull(controller) {
            const { value, done } = await iterator.next();
            if (done) {
                controller.close();
                return;
            }
            controller.enqueue(encoder.encode(value));
        },
        async cancel() {
            if (typeof iterator.return === 'function') {
                await iterator.return();
            }
        },
    });
}

async function* generateAdminBackupNdjson() {
    await prepareBackupSchemas();
    const db = getPool();
    const authUsers = await exportUserAccounts()
        .then((users) => ({ users, error: null }))
        .catch((err) => ({ users: [], error: err.message || 'Unable to export Supabase Auth users' }));
    const tableCounts = Object.fromEntries(
        await Promise.all(BACKUP_TABLES.map(async (config) => [config.key, await countTable(db, config.table)]))
    );
    const metadata = {
        type: 'metadata',
        version: 3,
        exported_at: new Date().toISOString(),
        source: 'deep-video-search-admin',
        format: 'ndjson',
        notes: {
            supabase_auth: authUsers.error
                || 'Auth users are backed up without passwords or active sessions. Restored users receive generated passwords and should reset passwords.',
        },
        counts: {
            users: authUsers.users.length,
            ...tableCounts,
        },
    };

    yield `${JSON.stringify(metadata)}\n`;
    for (const user of authUsers.users) {
        yield `${JSON.stringify({ type: 'row', table: 'users', data: user })}\n`;
    }

    for (const config of BACKUP_TABLES) {
        for await (const rowJson of exportTableJsonRows(db, config.table, config.columns)) {
            const row = JSON.parse(rowJson.replace(/^,\n?/, ''));
            yield `${JSON.stringify({ type: 'row', table: config.key, data: row })}\n`;
        }
    }
}

export function createAdminBackupNdjsonStream() {
    const encoder = new TextEncoder();
    const iterator = generateAdminBackupNdjson();

    return new ReadableStream({
        async pull(controller) {
            const { value, done } = await iterator.next();
            if (done) {
                controller.close();
                return;
            }
            controller.enqueue(encoder.encode(value));
        },
        async cancel() {
            if (typeof iterator.return === 'function') {
                await iterator.return();
            }
        },
    });
}

export async function importAdminBackup(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('File backup khong hop le');
    }

    const data = payload.data || payload;
    const hasRestorableData = Array.isArray(data.users)
        || Array.isArray(data.auth_users)
        || BACKUP_TABLES.some((config) => Array.isArray(data[config.key]));

    if (!hasRestorableData) {
        throw new Error('File backup khong co du lieu hop le de restore');
    }

    await prepareBackupSchemas();
    const db = getPool();
    const client = await db.connect();
    const result = {};

    try {
        await client.query('BEGIN');

        for (const config of BACKUP_TABLES) {
            const imported = await upsertRows(
                client,
                config.table,
                data[config.key] || [],
                config.columns,
                config.conflicts
            );
            result[`imported_${config.key}`] = imported;
        }

        for (const config of BACKUP_TABLES) {
            if (config.sequence) {
                await resetSequence(client, config.table, config.sequence);
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    const userRows = data.users || data.auth_users || [];
    const importedUsers = await importUserAccounts(userRows).catch((err) => ({
        imported: 0,
        created: 0,
        updated: 0,
        skipped: Array.isArray(userRows) ? userRows.length : 0,
        error: err.message || 'Unable to restore Supabase Auth users',
    }));

    return {
        imported_users: importedUsers.imported || 0,
        created_users: importedUsers.created || 0,
        updated_users: importedUsers.updated || 0,
        skipped_users: importedUsers.skipped || 0,
        user_restore_error: importedUsers.error || null,
        ...result,
    };
}

async function flushImportBatch(client, key, rows, result) {
    if (!rows.length) return;
    const config = BACKUP_TABLES.find((item) => item.key === key);
    if (!config) return;

    const imported = await upsertRows(client, config.table, rows, config.columns, config.conflicts);
    result[`imported_${config.key}`] = (result[`imported_${config.key}`] || 0) + imported;
}

export async function importAdminBackupRecords(records) {
    await prepareBackupSchemas();
    const db = getPool();
    const client = await db.connect();
    const result = {};
    const users = [];
    let activeKey = null;
    let activeRows = [];

    try {
        await client.query('BEGIN');

        for await (const record of records) {
            if (!record || record.type === 'metadata') continue;
            if (record.type !== 'row' || !record.table || !record.data) continue;

            if (record.table === 'users') {
                users.push(record.data);
                continue;
            }

            if (activeKey && activeKey !== record.table) {
                await flushImportBatch(client, activeKey, activeRows, result);
                activeRows = [];
            }

            activeKey = record.table;
            activeRows.push(record.data);

            if (activeRows.length >= 500) {
                await flushImportBatch(client, activeKey, activeRows, result);
                activeRows = [];
            }
        }

        if (activeKey && activeRows.length) {
            await flushImportBatch(client, activeKey, activeRows, result);
        }

        for (const config of BACKUP_TABLES) {
            if (config.sequence) {
                await resetSequence(client, config.table, config.sequence);
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    const importedUsers = await importUserAccounts(users).catch((err) => ({
        imported: 0,
        created: 0,
        updated: 0,
        skipped: users.length,
        error: err.message || 'Unable to restore Supabase Auth users',
    }));

    return {
        imported_users: importedUsers.imported || 0,
        created_users: importedUsers.created || 0,
        updated_users: importedUsers.updated || 0,
        skipped_users: importedUsers.skipped || 0,
        user_restore_error: importedUsers.error || null,
        ...result,
    };
}

export async function importAdminBackupNdjsonStream(stream) {
    async function* parseRecords() {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) yield JSON.parse(trimmed);
            }
        }

        buffer += decoder.decode();
        const trimmed = buffer.trim();
        if (trimmed) yield JSON.parse(trimmed);
    }

    return importAdminBackupRecords(parseRecords());
}
