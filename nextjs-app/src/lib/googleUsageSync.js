import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
    enrichUsedVideoRecords,
    getProfileDocSyncs,
    getProfileForUser,
    listProfiles,
    pruneProfileDocSyncs,
    replaceUsedVideos,
    setProfileSyncStatus,
    upsertProfileDocSync,
} from './usageProfiles';
import {
    extractYouTubeUrls,
    getThumbnailForVideoUrl,
    normalizeVideoUrl,
} from './videoUrl';

const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
];

let tokenCache = null;

function parseServiceAccountJson(rawJson) {
    const parsed = JSON.parse(rawJson);
    return {
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key?.replace(/\\n/g, '\n'),
    };
}

function resolveCredentialsPath(rawPath) {
    if (path.isAbsolute(rawPath)) return rawPath;

    const cwdPath = path.resolve(process.cwd(), rawPath);
    if (fs.existsSync(cwdPath)) return cwdPath;

    const parentPath = path.resolve(process.cwd(), '..', rawPath);
    if (fs.existsSync(parentPath)) return parentPath;

    return cwdPath;
}

function getServiceAccountConfig() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const credentialsPath = resolveCredentialsPath(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        return parseServiceAccountJson(fs.readFileSync(credentialsPath, 'utf8'));
    }

    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        return parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    }

    return {
        clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL,
        privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };
}

function base64Url(value) {
    return Buffer.from(JSON.stringify(value))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

async function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (tokenCache && tokenCache.expiresAt - 60 > now) {
        return tokenCache.accessToken;
    }

    const { clientEmail, privateKey } = getServiceAccountConfig();
    if (!clientEmail || !privateKey) {
        throw new Error('Missing Google service account config. Set GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY.');
    }

    const header = base64Url({ alg: 'RS256', typ: 'JWT' });
    const claim = base64Url({
        iss: clientEmail,
        scope: GOOGLE_SCOPES.join(' '),
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
    });
    const unsigned = `${header}.${claim}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const signature = signer
        .sign(privateKey, 'base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${unsigned}.${signature}`,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Google auth failed (${response.status}): ${text}`);
    }

    const json = await response.json();
    tokenCache = {
        accessToken: json.access_token,
        expiresAt: now + Number(json.expires_in || 3600),
    };
    return tokenCache.accessToken;
}

async function googleGetJson(url) {
    const token = await getAccessToken();
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Google API failed (${response.status}): ${text}`);
    }

    return response.json();
}

async function readDriveFileMetadata(fileId) {
    const params = new URLSearchParams({
        fields: 'id,name,modifiedTime',
        supportsAllDrives: 'true',
    });

    return googleGetJson(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`
    );
}

async function readDocMetadata(docId) {
    return readDriveFileMetadata(docId);
}

function extractSpreadsheetId(sheetUrl) {
    const text = String(sheetUrl || '').trim();
    const match = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
    return null;
}

function extractSheetGid(sheetUrl) {
    const text = String(sheetUrl || '').trim();
    try {
        const parsed = new URL(text);
        const gid = parsed.searchParams.get('gid') || parsed.hash.match(/gid=([0-9]+)/)?.[1];
        return gid || null;
    } catch {
        return text.match(/[#&?]gid=([0-9]+)/)?.[1] || null;
    }
}

function extractGoogleDocId(docUrl) {
    const text = String(docUrl || '').trim();
    const docMatch = text.match(/\/document\/d\/([A-Za-z0-9_-]+)/);
    if (docMatch) return docMatch[1];

    try {
        const parsed = new URL(text);
        if (parsed.hostname.includes('docs.google.com') || parsed.hostname.includes('drive.google.com')) {
            const id = parsed.searchParams.get('id');
            if (id) return id;
        }
    } catch {
        // Ignore invalid URLs.
    }

    return null;
}

function extractDocUrls(text) {
    const matches = String(text || '').match(/https?:\/\/(?:docs|drive)\.google\.com\/[^\s<>"'`)\]}]+/gi) || [];
    return matches.filter((url) => extractGoogleDocId(url));
}

function columnName(index) {
    let name = '';
    let current = index + 1;
    while (current > 0) {
        const remainder = (current - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        current = Math.floor((current - 1) / 26);
    }
    return name;
}

async function collectDocRefsFromSheet(sheetUrl, tabScope = 'current') {
    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) {
        throw new Error('Google Sheet URL không hợp lệ.');
    }
    const currentGid = extractSheetGid(sheetUrl);

    const spreadsheet = await googleGetJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true`
    );

    const refs = [];
    const seen = new Set();
    let selectedSheets = spreadsheet.sheets || [];

    if (tabScope !== 'all') {
        if (currentGid) {
            selectedSheets = selectedSheets.filter((sheet) => String(sheet.properties?.sheetId) === String(currentGid));
        } else {
            selectedSheets = selectedSheets.slice(0, 1);
        }
    }

    for (const sheet of selectedSheets) {
        const sheetTitle = sheet.properties?.title || 'Sheet';
        for (const grid of sheet.data || []) {
            const rows = grid.rowData || [];
            rows.forEach((row, rowIndex) => {
                const values = row.values || [];
                values.forEach((cell, colIndex) => {
                    const candidates = [
                        cell.formattedValue,
                        cell.hyperlink,
                        cell.effectiveValue?.stringValue,
                        cell.userEnteredValue?.stringValue,
                        cell.userEnteredValue?.formulaValue,
                        ...(cell.textFormatRuns || []).map((run) => run.format?.link?.uri),
                        ...(cell.chipRuns || []).map((run) => run.chip?.richLinkProperties?.uri),
                    ].filter(Boolean);

                    const cellRef = `${columnName(colIndex)}${rowIndex + 1}`;
                    const docUrls = candidates.flatMap(extractDocUrls);

                    for (const url of docUrls) {
                        const docId = extractGoogleDocId(url);
                        if (!docId) continue;

                        const key = `${docId}:${sheetTitle}:${cellRef}`;
                        if (seen.has(key)) continue;
                        seen.add(key);

                        refs.push({
                            docId,
                            docUrl: `https://docs.google.com/document/d/${docId}/edit`,
                            sheetTitle,
                            cell: cellRef,
                        });
                    }
                });
            });
        }
    }

    return {
        refs,
        selectedSheetCount: selectedSheets.length,
        selectedSheetTitles: selectedSheets.map((sheet) => sheet.properties?.title).filter(Boolean),
        currentGid,
    };
}

function collectDocTextAndLinks(document) {
    const text = [];
    const links = [];

    function walkElement(element) {
        if (!element || typeof element !== 'object') return;

        if (element.textRun) {
            if (element.textRun.content) text.push(element.textRun.content);
            const linkUrl = element.textRun.textStyle?.link?.url;
            if (linkUrl) links.push(linkUrl);
        }

        if (element.richLink?.richLinkProperties?.uri) {
            links.push(element.richLink.richLinkProperties.uri);
        }

        if (element.paragraph?.elements) {
            element.paragraph.elements.forEach(walkElement);
        }

        if (element.table?.tableRows) {
            for (const row of element.table.tableRows) {
                for (const cell of row.tableCells || []) {
                    for (const content of cell.content || []) {
                        walkElement(content);
                    }
                }
            }
        }

        if (element.tableOfContents?.content) {
            element.tableOfContents.content.forEach(walkElement);
        }
    }

    for (const element of document.body?.content || []) {
        walkElement(element);
    }

    return {
        text: text.join('\n'),
        links,
    };
}

async function readDocVideos(docRef) {
    const document = await googleGetJson(
        `https://docs.googleapis.com/v1/documents/${docRef.docId}?fields=title,body`
    );
    const { text, links } = collectDocTextAndLinks(document);
    const urls = extractYouTubeUrls(`${text}\n${links.join('\n')}`);

    return urls.map((url) => ({
        url,
        documentTitle: document.title || 'Untitled Google Doc',
    }));
}

function getTimeMs(value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

function canReuseDocCache(profile, cachedDoc, metadata) {
    if (!cachedDoc || !metadata?.modifiedTime || !profile.last_sync_at) return false;
    if (cachedDoc.last_error) return false;

    const modifiedAt = getTimeMs(metadata.modifiedTime);
    const cachedModifiedAt = getTimeMs(cachedDoc.modified_time);
    const lastSyncAt = getTimeMs(profile.last_sync_at);
    if (!modifiedAt || !lastSyncAt) return false;

    return cachedModifiedAt ? modifiedAt <= cachedModifiedAt : modifiedAt <= lastSyncAt;
}

async function getAutoSyncDecision(profile) {
    if (!profile.last_sync_at) {
        return {
            shouldSync: true,
            reason: 'never_synced',
            sheet_modified_time: null,
            last_sync_at: null,
        };
    }

    const spreadsheetId = extractSpreadsheetId(profile.google_sheet_url);
    if (!spreadsheetId) {
        return {
            shouldSync: true,
            reason: 'invalid_sheet_url',
            sheet_modified_time: null,
            last_sync_at: profile.last_sync_at,
        };
    }

    const metadata = await readDriveFileMetadata(spreadsheetId);
    const sheetModifiedAt = getTimeMs(metadata.modifiedTime);
    const lastSyncAt = getTimeMs(profile.last_sync_at);

    if (!sheetModifiedAt || !lastSyncAt) {
        return {
            shouldSync: true,
            reason: 'missing_sheet_metadata',
            sheet_modified_time: metadata.modifiedTime || null,
            last_sync_at: profile.last_sync_at,
            sheet_name: metadata.name || '',
        };
    }

    const shouldSync = sheetModifiedAt > lastSyncAt;
    return {
        shouldSync,
        reason: shouldSync ? 'sheet_modified' : 'sheet_unchanged',
        sheet_modified_time: metadata.modifiedTime,
        last_sync_at: profile.last_sync_at,
        sheet_name: metadata.name || '',
    };
}

function groupDocRefs(docRefs) {
    const refsByDocId = new Map();
    for (const docRef of docRefs) {
        if (!refsByDocId.has(docRef.docId)) refsByDocId.set(docRef.docId, []);
        refsByDocId.get(docRef.docId).push(docRef);
    }
    return refsByDocId;
}

function normalizeCachedVideos(videos) {
    return Array.isArray(videos)
        ? videos
            .filter((video) => video?.url)
            .map((video) => ({
                url: video.url,
                documentTitle: video.documentTitle || video.title || 'Untitled Google Doc',
            }))
        : [];
}

function addDocVideosToRecords(byVideoKey, docRefs, videos, syncedAt) {
    for (const docRef of docRefs) {
        for (const video of videos) {
            const normalized = normalizeVideoUrl(video.url);
            if (!normalized?.youtubeId) continue;

            if (!byVideoKey.has(normalized.videoKey)) {
                byVideoKey.set(normalized.videoKey, {
                    videoKey: normalized.videoKey,
                    url: normalized.canonicalUrl,
                    title: '',
                    thumbnail: getThumbnailForVideoUrl(normalized.canonicalUrl),
                    occurrences: [],
                });
            }

            byVideoKey.get(normalized.videoKey).occurrences.push({
                docTitle: video.documentTitle || 'Untitled Google Doc',
                docUrl: docRef.docUrl,
                sheetTab: docRef.sheetTitle,
                cell: docRef.cell,
                syncedAt,
            });
        }
    }
}

export async function syncUsageProfile(profileId, userEmail) {
    const profile = await getProfileForUser(profileId, userEmail);
    if (!profile) return null;

    await setProfileSyncStatus(profileId, userEmail, 'syncing', null);

    try {
        const {
            refs: docRefs,
            selectedSheetCount,
            selectedSheetTitles,
            currentGid,
        } = await collectDocRefsFromSheet(profile.google_sheet_url, profile.tab_scope);
        const byVideoKey = new Map();
        const warnings = [];
        const syncedAt = new Date().toISOString();
        const refsByDocId = groupDocRefs(docRefs);
        const uniqueDocIds = [...refsByDocId.keys()];
        const cachedDocs = await getProfileDocSyncs(profileId, userEmail, uniqueDocIds);

        await pruneProfileDocSyncs(profileId, userEmail, uniqueDocIds);

        let refreshedDocCount = 0;
        let skippedDocCount = 0;
        let cachedFallbackDocCount = 0;
        let metadataWarningCount = 0;

        for (const [docId, refs] of refsByDocId.entries()) {
            const primaryRef = refs[0];
            const cachedDoc = cachedDocs.get(docId);
            let metadata = null;

            try {
                try {
                    metadata = await readDocMetadata(docId);
                } catch (err) {
                    metadataWarningCount += 1;
                    warnings.push({
                        docUrl: primaryRef.docUrl,
                        sheetTab: primaryRef.sheetTitle,
                        cell: primaryRef.cell,
                        error: `Khong doc duoc thoi diem sua Google Doc: ${err.message}. Da doc noi dung Doc truc tiep.`,
                    });
                }

                let videos = null;
                let title = metadata?.name || cachedDoc?.title || 'Untitled Google Doc';

                if (canReuseDocCache(profile, cachedDoc, metadata)) {
                    videos = normalizeCachedVideos(cachedDoc.videos);
                    skippedDocCount += 1;
                } else {
                    videos = await readDocVideos(primaryRef);
                    refreshedDocCount += 1;

                    const documentTitle = videos.find((video) => video.documentTitle)?.documentTitle || title;
                    title = documentTitle;

                    await upsertProfileDocSync(profileId, userEmail, {
                        docId,
                        docUrl: primaryRef.docUrl,
                        title,
                        modifiedTime: metadata?.modifiedTime || null,
                        videos,
                    });
                }

                addDocVideosToRecords(byVideoKey, refs, videos, syncedAt);
            } catch (err) {
                const cachedVideos = normalizeCachedVideos(cachedDoc?.videos);
                if (cachedDoc && cachedVideos.length > 0) {
                    cachedFallbackDocCount += 1;
                    addDocVideosToRecords(byVideoKey, refs, cachedVideos, syncedAt);
                    warnings.push({
                        docUrl: primaryRef.docUrl,
                        sheetTab: primaryRef.sheetTitle,
                        cell: primaryRef.cell,
                        error: `${err.message}. Dang dung cache cu cua Google Doc nay.`,
                    });
                } else {
                    warnings.push({
                        docUrl: primaryRef.docUrl,
                        sheetTab: primaryRef.sheetTitle,
                        cell: primaryRef.cell,
                        error: err.message,
                    });

                    await upsertProfileDocSync(profileId, userEmail, {
                        docId,
                        docUrl: primaryRef.docUrl,
                        title: metadata?.name || cachedDoc?.title || 'Untitled Google Doc',
                        modifiedTime: metadata?.modifiedTime || cachedDoc?.modified_time || null,
                        videos: cachedVideos,
                        error: err.message,
                    });
                }
            }
        }

        const records = await enrichUsedVideoRecords([...byVideoKey.values()]);
        const count = await replaceUsedVideos(profileId, userEmail, records);
        const noSelectedSheets = selectedSheetCount === 0;
        const noDocRefs = docRefs.length === 0;
        const noVideos = docRefs.length > 0 && records.length === 0;

        const updatedProfile = await setProfileSyncStatus(
            profileId,
            userEmail,
            warnings.length > 0 || noSelectedSheets || noDocRefs || noVideos ? 'success_with_warnings' : 'success',
            noSelectedSheets
                ? `Không tìm thấy tab có gid=${currentGid || '(trống)'} trong Google Sheet. Hãy mở đúng tab rồi lưu lại Sheet URL.`
                : noDocRefs
                ? 'Không tìm thấy Google Doc link trong Google Sheet. Hãy kiểm tra quyền share và định dạng link/chip.'
                : noVideos
                    ? `Đã tìm thấy ${docRefs.length} Google Doc nhưng chưa đọc được YouTube URL nào trong các Doc.`
                    : warnings.length > 0
                        ? `${warnings.length} Google Doc không đọc được. Xem server log để biết chi tiết.`
                        : null
        );

        if (warnings.length > 0) {
            console.warn('Usage profile sync warnings:', warnings);
        }

        return {
            profile: updatedProfile,
            used_count: count,
            doc_count: docRefs.length,
            unique_doc_count: uniqueDocIds.length,
            refreshed_doc_count: refreshedDocCount,
            skipped_doc_count: skippedDocCount,
            cached_fallback_doc_count: cachedFallbackDocCount,
            metadata_warning_count: metadataWarningCount,
            tab_scope: profile.tab_scope,
            sheet_count: selectedSheetCount,
            sheet_titles: selectedSheetTitles,
            warning_count: warnings.length,
        };
    } catch (err) {
        await setProfileSyncStatus(profileId, userEmail, 'failed', err.message);
        throw err;
    }
}

export async function syncAllUsageProfiles(userEmail) {
    const { profiles } = await listProfiles(userEmail);
    const results = [];

    for (const profile of profiles) {
        let autoSyncDecision = null;

        try {
            try {
                autoSyncDecision = await getAutoSyncDecision(profile);
            } catch (err) {
                autoSyncDecision = {
                    shouldSync: true,
                    reason: 'sheet_metadata_check_failed',
                    check_error: err.message,
                    sheet_modified_time: null,
                    last_sync_at: profile.last_sync_at || null,
                };
            }

            if (!autoSyncDecision.shouldSync) {
                results.push({
                    ok: true,
                    skipped: true,
                    profile_id: profile.id,
                    name: profile.name,
                    reason: autoSyncDecision.reason,
                    sheet_modified_time: autoSyncDecision.sheet_modified_time,
                    last_sync_at: autoSyncDecision.last_sync_at,
                    sheet_name: autoSyncDecision.sheet_name || '',
                });
                continue;
            }

            const result = await syncUsageProfile(profile.id, userEmail);
            results.push({
                ok: Boolean(result),
                skipped: false,
                profile_id: profile.id,
                name: profile.name,
                auto_sync_reason: autoSyncDecision.reason,
                auto_sync_check_error: autoSyncDecision.check_error || null,
                sheet_modified_time: autoSyncDecision.sheet_modified_time,
                last_sync_at: autoSyncDecision.last_sync_at,
                sheet_name: autoSyncDecision.sheet_name || '',
                ...(result || {}),
            });
        } catch (err) {
            results.push({
                ok: false,
                skipped: false,
                profile_id: profile.id,
                name: profile.name,
                auto_sync_reason: autoSyncDecision?.reason || 'unknown',
                sheet_modified_time: autoSyncDecision?.sheet_modified_time || null,
                last_sync_at: autoSyncDecision?.last_sync_at || profile.last_sync_at || null,
                error: err.message,
            });
        }
    }

    return {
        profile_count: profiles.length,
        synced_count: results.filter((result) => result.ok && !result.skipped).length,
        skipped_count: results.filter((result) => result.skipped).length,
        failed_count: results.filter((result) => !result.ok).length,
        results,
    };
}
