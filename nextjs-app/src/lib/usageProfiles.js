import { ensureUsageSchema, getPool } from './localDb';

function normalizeProfile(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        user_email: row.user_email,
        name: row.name,
        google_sheet_url: row.google_sheet_url,
        tab_scope: ['current', 'all'].includes(row.tab_scope) ? row.tab_scope : 'current',
        last_sync_at: row.last_sync_at,
        sync_status: row.sync_status || 'idle',
        sync_error: row.sync_error || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        used_count: Number(row.used_count || 0),
    };
}

export async function listProfiles(userEmail) {
    await ensureUsageSchema();
    const db = getPool();

    const [profileResult, settingResult] = await Promise.all([
        db.query(
            `
                SELECT p.*, COUNT(pu.id) AS used_count
                FROM usage_profiles p
                LEFT JOIN profile_used_videos pu ON pu.profile_id = p.id
                WHERE p.user_email = $1
                GROUP BY p.id
                ORDER BY p.created_at DESC
            `,
            [userEmail]
        ),
        db.query(`SELECT active_profile_id FROM usage_user_settings WHERE user_email = $1`, [userEmail]),
    ]);

    const profiles = profileResult.rows.map(normalizeProfile);
    let activeProfileId = settingResult.rows[0]?.active_profile_id ? String(settingResult.rows[0].active_profile_id) : null;

    if (activeProfileId && !profiles.some((profile) => profile.id === activeProfileId)) {
        activeProfileId = null;
        await setActiveProfile(userEmail, null);
    }

    return {
        profiles,
        activeProfileId,
        activeProfile: profiles.find((profile) => profile.id === activeProfileId) || null,
    };
}

export async function getActiveProfile(userEmail) {
    const { activeProfile } = await listProfiles(userEmail);
    return activeProfile;
}

export async function getProfileForUser(profileId, userEmail) {
    await ensureUsageSchema();
    const db = getPool();
    const result = await db.query(
        `
            SELECT p.*, COUNT(pu.id) AS used_count
            FROM usage_profiles p
            LEFT JOIN profile_used_videos pu ON pu.profile_id = p.id
            WHERE p.id = $1 AND p.user_email = $2
            GROUP BY p.id
        `,
        [profileId, userEmail]
    );

    return normalizeProfile(result.rows[0]);
}

function normalizeTabScope(tabScope) {
    return tabScope === 'all' ? 'all' : 'current';
}

export async function createProfile(userEmail, { name, googleSheetUrl, tabScope = 'current' }) {
    await ensureUsageSchema();
    const db = getPool();
    const result = await db.query(
        `
            INSERT INTO usage_profiles (user_email, name, google_sheet_url, tab_scope)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `,
        [userEmail, name.trim(), googleSheetUrl.trim(), normalizeTabScope(tabScope)]
    );

    return normalizeProfile(result.rows[0]);
}

export async function updateProfile(userEmail, profileId, { name, googleSheetUrl, tabScope }) {
    await ensureUsageSchema();
    const db = getPool();
    const result = await db.query(
        `
            UPDATE usage_profiles
            SET name = COALESCE($3, name),
                google_sheet_url = COALESCE($4, google_sheet_url),
                tab_scope = COALESCE($5, tab_scope),
                updated_at = NOW()
            WHERE id = $1 AND user_email = $2
            RETURNING *
        `,
        [
            profileId,
            userEmail,
            name?.trim() || null,
            googleSheetUrl?.trim() || null,
            tabScope ? normalizeTabScope(tabScope) : null,
        ]
    );

    return normalizeProfile(result.rows[0]);
}

export async function deleteProfile(userEmail, profileId) {
    await ensureUsageSchema();
    const db = getPool();
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const deleted = await client.query(
            `DELETE FROM usage_profiles WHERE id = $1 AND user_email = $2 RETURNING id`,
            [profileId, userEmail]
        );

        if (deleted.rowCount === 0) {
            await client.query('ROLLBACK');
            return false;
        }

        const setting = await client.query(
            `SELECT active_profile_id FROM usage_user_settings WHERE user_email = $1`,
            [userEmail]
        );

        if (String(setting.rows[0]?.active_profile_id || '') === String(profileId)) {
            await client.query(
                `
                    INSERT INTO usage_user_settings (user_email, active_profile_id, updated_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (user_email) DO UPDATE SET
                        active_profile_id = EXCLUDED.active_profile_id,
                        updated_at = NOW()
                `,
                [userEmail, null]
            );
        }

        await client.query('COMMIT');
        return true;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function setActiveProfile(userEmail, profileId) {
    await ensureUsageSchema();
    const db = getPool();

    if (profileId) {
        const profile = await getProfileForUser(profileId, userEmail);
        if (!profile) return null;
    }

    await db.query(
        `
            INSERT INTO usage_user_settings (user_email, active_profile_id, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (user_email) DO UPDATE SET
                active_profile_id = EXCLUDED.active_profile_id,
                updated_at = NOW()
        `,
        [userEmail, profileId]
    );

    return profileId ? getProfileForUser(profileId, userEmail) : null;
}

export async function setProfileSyncStatus(profileId, userEmail, status, error = null) {
    await ensureUsageSchema();
    const db = getPool();
    const result = await db.query(
        `
            UPDATE usage_profiles
            SET sync_status = $3,
                sync_error = $4,
                last_sync_at = CASE WHEN $3 IN ('success', 'success_with_warnings') THEN NOW() ELSE last_sync_at END,
                updated_at = NOW()
            WHERE id = $1 AND user_email = $2
            RETURNING *
        `,
        [profileId, userEmail, status, error]
    );

    return normalizeProfile(result.rows[0]);
}

function normalizeDocSync(row) {
    if (!row) return null;
    return {
        doc_id: row.doc_id,
        doc_url: row.doc_url,
        title: row.title || '',
        modified_time: row.modified_time,
        videos: Array.isArray(row.videos) ? row.videos : [],
        last_synced_at: row.last_synced_at,
        last_error: row.last_error || null,
    };
}

export async function getProfileDocSyncs(profileId, userEmail, docIds = []) {
    await ensureUsageSchema();
    const ids = [...new Set((docIds || []).filter(Boolean))];
    if (ids.length === 0) return new Map();

    const db = getPool();
    const result = await db.query(
        `
            SELECT ds.*
            FROM profile_doc_syncs ds
            INNER JOIN usage_profiles p ON p.id = ds.profile_id
            WHERE ds.profile_id = $1
              AND p.user_email = $2
              AND ds.doc_id = ANY($3)
        `,
        [profileId, userEmail, ids]
    );

    return new Map(result.rows.map((row) => [row.doc_id, normalizeDocSync(row)]));
}

export async function upsertProfileDocSync(profileId, userEmail, docState) {
    await ensureUsageSchema();
    const db = getPool();
    const result = await db.query(
        `
            INSERT INTO profile_doc_syncs
                (profile_id, doc_id, doc_url, title, modified_time, videos, last_synced_at, last_error, updated_at)
            SELECT $1, $3, $4, $5, $6, $7::jsonb, NOW(), $8, NOW()
            WHERE EXISTS (
                SELECT 1 FROM usage_profiles WHERE id = $1 AND user_email = $2
            )
            ON CONFLICT (profile_id, doc_id) DO UPDATE SET
                doc_url = EXCLUDED.doc_url,
                title = EXCLUDED.title,
                modified_time = EXCLUDED.modified_time,
                videos = EXCLUDED.videos,
                last_synced_at = NOW(),
                last_error = EXCLUDED.last_error,
                updated_at = NOW()
            RETURNING *
        `,
        [
            profileId,
            userEmail,
            docState.docId,
            docState.docUrl,
            docState.title || '',
            docState.modifiedTime || null,
            JSON.stringify(docState.videos || []),
            docState.error || null,
        ]
    );

    return normalizeDocSync(result.rows[0]);
}

export async function pruneProfileDocSyncs(profileId, userEmail, docIds = []) {
    await ensureUsageSchema();
    const ids = [...new Set((docIds || []).filter(Boolean))];
    const db = getPool();

    if (ids.length === 0) {
        await db.query(
            `
                DELETE FROM profile_doc_syncs ds
                USING usage_profiles p
                WHERE ds.profile_id = p.id
                  AND ds.profile_id = $1
                  AND p.user_email = $2
            `,
            [profileId, userEmail]
        );
        return;
    }

    await db.query(
        `
            DELETE FROM profile_doc_syncs ds
            USING usage_profiles p
            WHERE ds.profile_id = p.id
              AND ds.profile_id = $1
              AND p.user_email = $2
              AND NOT (ds.doc_id = ANY($3))
        `,
        [profileId, userEmail, ids]
    );
}

export async function enrichUsedVideoRecords(records) {
    await ensureUsageSchema();
    if (records.length === 0) return [];

    const db = getPool();
    const keys = records.map((record) => record.videoKey);
    const urls = records.map((record) => record.url);
    const result = await db.query(
        `
            SELECT video_key, url, title, thumbnail
            FROM videos
            WHERE video_key = ANY($1) OR url = ANY($2)
        `,
        [keys, urls]
    );

    const byKey = new Map();
    const byUrl = new Map();
    for (const row of result.rows) {
        if (row.video_key && !byKey.has(row.video_key)) byKey.set(row.video_key, row);
        if (row.url && !byUrl.has(row.url)) byUrl.set(row.url, row);
    }

    return records.map((record) => {
        const match = byKey.get(record.videoKey) || byUrl.get(record.url);
        return {
            ...record,
            title: match?.title || record.title || '',
            thumbnail: match?.thumbnail || record.thumbnail || '',
        };
    });
}

export async function replaceUsedVideos(profileId, userEmail, records) {
    await ensureUsageSchema();
    const db = getPool();
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const profile = await client.query(
            `SELECT id FROM usage_profiles WHERE id = $1 AND user_email = $2 FOR UPDATE`,
            [profileId, userEmail]
        );

        if (profile.rowCount === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        await client.query(`DELETE FROM profile_used_videos WHERE profile_id = $1`, [profileId]);

        for (const record of records) {
            await client.query(
                `
                    INSERT INTO profile_used_videos
                        (profile_id, video_key, url, title, thumbnail, occurrences, first_seen_at, last_seen_at)
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
                    ON CONFLICT (profile_id, video_key) DO UPDATE SET
                        url = EXCLUDED.url,
                        title = EXCLUDED.title,
                        thumbnail = EXCLUDED.thumbnail,
                        occurrences = EXCLUDED.occurrences,
                        last_seen_at = NOW()
                `,
                [
                    profileId,
                    record.videoKey,
                    record.url,
                    record.title || '',
                    record.thumbnail || '',
                    JSON.stringify(record.occurrences || []),
                ]
            );
        }

        await client.query(
            `
                UPDATE usage_profiles
                SET sync_status = 'success',
                    sync_error = NULL,
                    last_sync_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1 AND user_email = $2
            `,
            [profileId, userEmail]
        );

        await client.query('COMMIT');
        return records.length;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function listUsedVideos(userEmail, profileId, { page = 1, pageSize = 100, query = '' } = {}) {
    await ensureUsageSchema();
    const db = getPool();
    const offset = (page - 1) * pageSize;
    const search = String(query || '').trim();
    const params = [profileId, userEmail];
    const conditions = [`pu.profile_id = $1`, `p.user_email = $2`];

    if (search) {
        params.push(`%${search}%`);
        const searchParam = params.length;
        conditions.push(`
            (
                pu.title ILIKE $${searchParam}
                OR pu.url ILIKE $${searchParam}
                OR pu.video_key ILIKE $${searchParam}
                OR pu.occurrences::text ILIKE $${searchParam}
            )
        `);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await db.query(
        `
            SELECT COUNT(*) AS total
            FROM profile_used_videos pu
            INNER JOIN usage_profiles p ON p.id = pu.profile_id
            ${whereClause}
        `,
        params
    );

    const dataParams = [...params, pageSize, offset];
    const limitParam = dataParams.length - 1;
    const offsetParam = dataParams.length;
    const dataResult = await db.query(
        `
            SELECT pu.video_key, pu.url, pu.title, pu.thumbnail, pu.occurrences, pu.first_seen_at, pu.last_seen_at
            FROM profile_used_videos pu
            INNER JOIN usage_profiles p ON p.id = pu.profile_id
            ${whereClause}
            ORDER BY pu.last_seen_at DESC, pu.id DESC
            LIMIT $${limitParam} OFFSET $${offsetParam}
        `,
        dataParams
    );

    return {
        data: dataResult.rows.map((row) => ({
            video_key: row.video_key,
            url: row.url,
            title: row.title || '',
            thumbnail: row.thumbnail || '',
            occurrences: row.occurrences || [],
            first_seen_at: row.first_seen_at,
            last_seen_at: row.last_seen_at,
        })),
        total: Number(countResult.rows[0]?.total || 0),
        page,
        page_size: pageSize,
        query: search,
    };
}
