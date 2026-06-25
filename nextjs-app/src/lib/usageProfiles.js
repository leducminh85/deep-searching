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

    if (!activeProfileId && profiles.length > 0) {
        activeProfileId = profiles[0].id;
        await setActiveProfile(userEmail, activeProfileId);
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

    const profile = normalizeProfile(result.rows[0]);
    const { activeProfileId } = await listProfiles(userEmail);
    if (!activeProfileId || activeProfileId === profile.id) {
        await setActiveProfile(userEmail, profile.id);
    }

    return profile;
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
            const nextProfile = await client.query(
                `SELECT id FROM usage_profiles WHERE user_email = $1 ORDER BY created_at DESC LIMIT 1`,
                [userEmail]
            );
            await client.query(
                `
                    INSERT INTO usage_user_settings (user_email, active_profile_id, updated_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (user_email) DO UPDATE SET
                        active_profile_id = EXCLUDED.active_profile_id,
                        updated_at = NOW()
                `,
                [userEmail, nextProfile.rows[0]?.id || null]
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
                last_sync_at = CASE WHEN $3 = 'success' THEN NOW() ELSE last_sync_at END,
                updated_at = NOW()
            WHERE id = $1 AND user_email = $2
            RETURNING *
        `,
        [profileId, userEmail, status, error]
    );

    return normalizeProfile(result.rows[0]);
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

export async function listUsedVideos(userEmail, profileId, { page = 1, pageSize = 100 } = {}) {
    await ensureUsageSchema();
    const db = getPool();
    const offset = (page - 1) * pageSize;

    const countResult = await db.query(
        `
            SELECT COUNT(*) AS total
            FROM profile_used_videos pu
            INNER JOIN usage_profiles p ON p.id = pu.profile_id
            WHERE pu.profile_id = $1 AND p.user_email = $2
        `,
        [profileId, userEmail]
    );

    const dataResult = await db.query(
        `
            SELECT pu.video_key, pu.url, pu.title, pu.thumbnail, pu.occurrences, pu.first_seen_at, pu.last_seen_at
            FROM profile_used_videos pu
            INNER JOIN usage_profiles p ON p.id = pu.profile_id
            WHERE pu.profile_id = $1 AND p.user_email = $2
            ORDER BY pu.last_seen_at DESC, pu.id DESC
            LIMIT $3 OFFSET $4
        `,
        [profileId, userEmail, pageSize, offset]
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
    };
}
