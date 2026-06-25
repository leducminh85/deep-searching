import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
    enrichUsedVideoRecords,
    getProfileForUser,
    replaceUsedVideos,
    setProfileSyncStatus,
} from './usageProfiles';
import {
    extractYouTubeUrls,
    getThumbnailForVideoUrl,
    normalizeVideoUrl,
} from './videoUrl';

const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/documents.readonly',
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

        for (const docRef of docRefs) {
            try {
                const videos = await readDocVideos(docRef);
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
                        docTitle: video.documentTitle,
                        docUrl: docRef.docUrl,
                        sheetTab: docRef.sheetTitle,
                        cell: docRef.cell,
                        syncedAt,
                    });
                }
            } catch (err) {
                warnings.push({
                    docUrl: docRef.docUrl,
                    sheetTab: docRef.sheetTitle,
                    cell: docRef.cell,
                    error: err.message,
                });
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
