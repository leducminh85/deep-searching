import { insertOrUpdateVideos, markChannelSyncState } from './adminDb';

const DEFAULT_MIN_VIDEO_DURATION_SECONDS = 180;
const runningJobs = new Map();
const runningMetadataJobs = new Map();

function getApiKey() {
    return process.env.YOUTUBE_API_KEY;
}

function resolveMinDurationSeconds(value) {
    if (value !== undefined) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }

    const envValue = Number(process.env.MIN_SYNC_VIDEO_DURATION_SECONDS);
    return Number.isFinite(envValue) && envValue > 0 ? envValue : DEFAULT_MIN_VIDEO_DURATION_SECONDS;
}

function parseDurationSeconds(duration = '') {
    const match = String(duration).match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!match) return null;
    const [, days = 0, hours = 0, minutes = 0, seconds = 0] = match.map((value) => Number(value || 0));
    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function extractChannelRef(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return {};

    const handleMatch = value.match(/(?:youtube\.com\/)?@([\w.-]+)/i);
    if (handleMatch) return { handle: `@${handleMatch[1]}` };

    const idMatch = value.match(/(?:youtube\.com\/)?channel\/(UC[\w-]{22})/i);
    if (idMatch) return { channelId: idMatch[1] };

    const userMatch = value.match(/(?:youtube\.com\/)?user\/([\w.-]+)/i);
    if (userMatch) return { username: userMatch[1] };

    const customMatch = value.match(/(?:youtube\.com\/)?(?:c\/)?([\w.-]+)$/i);
    if (customMatch && !value.includes('watch?')) return { query: customMatch[1] };

    return { query: value };
}

function normalizeHandle(value) {
    const cleaned = String(value || '').trim();
    if (!cleaned) return '';
    const withoutUrl = cleaned
        .replace(/^https?:\/\/(www\.)?youtube\.com\//i, '')
        .replace(/^@?/, '');
    const handle = withoutUrl.split(/[/?#]/)[0];
    return handle ? `@${handle}` : '';
}

function isAbortError(err) {
    return err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || /aborted|stopped by admin/i.test(String(err?.message || ''));
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const err = new Error('Stopped by admin');
    err.name = 'AbortError';
    throw err;
}

async function youtubeGet(path, params = {}, options = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('YOUTUBE_API_KEY is not configured');
    }
    throwIfAborted(options.signal);

    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    url.searchParams.set('key', apiKey);
    for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetch(url, { signal: options.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || `YouTube API failed (${response.status})`);
    }
    return payload;
}

async function resolveChannel(rawUrl, options = {}) {
    const ref = extractChannelRef(rawUrl);
    let payload = null;

    if (ref.channelId) {
        payload = await youtubeGet('channels', {
            part: 'snippet,contentDetails',
            id: ref.channelId,
            maxResults: 1,
        }, options);
    } else if (ref.handle) {
        payload = await youtubeGet('channels', {
            part: 'snippet,contentDetails',
            forHandle: ref.handle,
            maxResults: 1,
        }, options);
    } else if (ref.username) {
        payload = await youtubeGet('channels', {
            part: 'snippet,contentDetails',
            forUsername: ref.username,
            maxResults: 1,
        }, options);
    }

    if (!payload?.items?.length && ref.query) {
        const search = await youtubeGet('search', {
            part: 'snippet',
            q: ref.query,
            type: 'channel',
            maxResults: 1,
        }, options);
        const channelId = search.items?.[0]?.snippet?.channelId;
        if (channelId) {
            payload = await youtubeGet('channels', {
                part: 'snippet,contentDetails',
                id: channelId,
                maxResults: 1,
            }, options);
        }
    }

    const channel = payload?.items?.[0];
    if (!channel) {
        throw new Error('Không tìm thấy kênh YouTube từ URL này');
    }

    const channelHandle = normalizeHandle(channel.snippet?.customUrl) || ref.handle || '';

    return {
        channelId: channelHandle || `@${channel.id}`,
        channelName: channel.snippet?.title || channel.id,
        channelUrl: channelHandle ? `https://www.youtube.com/${channelHandle}` : `https://www.youtube.com/channel/${channel.id}`,
        channelThumbnail: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.medium?.url || channel.snippet?.thumbnails?.default?.url || '',
        uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads,
    };
}

async function runChannelMetadataSync(channelRow) {
    try {
        const resolved = await resolveChannel(channelRow.channel_url);
        await markChannelSyncState(channelRow.id, {
            channel_id: resolved.channelId,
            channel_name: resolved.channelName,
            channel_url: resolved.channelUrl,
            channel_thumbnail: resolved.channelThumbnail,
            last_error: null,
        });
    } catch (err) {
        await markChannelSyncState(channelRow.id, {
            last_error: err.message || 'Channel metadata sync failed',
        });
    } finally {
        runningMetadataJobs.delete(String(channelRow.id));
    }
}

export function startChannelMetadataSync(channelRow) {
    const hasHandle = String(channelRow?.channel_id || '').startsWith('@');
    const hasName = channelRow?.channel_name && !/^https?:\/\//i.test(channelRow.channel_name);
    if (!channelRow?.channel_url || (channelRow.channel_thumbnail && hasHandle && hasName)) return false;
    const key = String(channelRow.id);
    if (runningMetadataJobs.has(key)) return false;

    const job = runChannelMetadataSync(channelRow);
    runningMetadataJobs.set(key, job);
    job.catch(() => {});
    return true;
}

export function startMissingChannelMetadataSync(channels, limit = 12) {
    let started = 0;
    for (const channel of channels) {
        if (started >= limit) break;
        if (startChannelMetadataSync(channel)) started += 1;
    }
    return started;
}

async function fetchPlaylistVideos(playlistId, channelName, options = {}) {
    const playlistItems = [];
    let pageToken = null;

    do {
        throwIfAborted(options.signal);
        const payload = await youtubeGet('playlistItems', {
            part: 'snippet,contentDetails',
            playlistId,
            maxResults: 50,
            pageToken,
        }, options);
        playlistItems.push(...(payload.items || []));
        pageToken = payload.nextPageToken || null;
    } while (pageToken);

    const videos = [];
    for (let index = 0; index < playlistItems.length; index += 50) {
        throwIfAborted(options.signal);
        const batch = playlistItems.slice(index, index + 50);
        const ids = batch
            .map((item) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId)
            .filter(Boolean);

        if (!ids.length) continue;

        const detail = await youtubeGet('videos', {
            part: 'snippet,statistics,contentDetails',
            id: ids.join(','),
            maxResults: 50,
        }, options);

        for (const item of detail.items || []) {
            const videoId = item.id;
            const snippet = item.snippet || {};
            videos.push({
                title: snippet.title || '',
                url: `https://www.youtube.com/watch?v=${videoId}`,
                channelName: channelName || snippet.channelTitle || '',
                views: Number(item.statistics?.viewCount || 0),
                datePublished: snippet.publishedAt || null,
                thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
                videoKey: `yt:${videoId}`,
                durationSeconds: parseDurationSeconds(item.contentDetails?.duration),
                caption: '',
                summary: '',
            });
        }
    }

    return videos;
}

export async function syncChannelVideos(channelRow, rawUrl, options = {}) {
    const minDurationSeconds = resolveMinDurationSeconds(options.minDurationSeconds);
    const signal = options.signal;

    await markChannelSyncState(channelRow.id, {
        sync_status: 'running',
        analysis_status: 'pending',
        last_error: null,
    });

    try {
        throwIfAborted(signal);
        const resolved = await resolveChannel(rawUrl || channelRow.channel_url, { signal });
        if (!resolved.uploadsPlaylistId) {
            throw new Error('Không tìm thấy uploads playlist của kênh');
        }

        await markChannelSyncState(channelRow.id, {
            channel_id: resolved.channelId,
            channel_name: resolved.channelName,
            channel_url: resolved.channelUrl,
            channel_thumbnail: resolved.channelThumbnail,
        });

        const fetchedVideos = await fetchPlaylistVideos(resolved.uploadsPlaylistId, resolved.channelName, { signal });
        throwIfAborted(signal);
        const videos = minDurationSeconds > 0
            ? fetchedVideos.filter((video) => !video.durationSeconds || video.durationSeconds > minDurationSeconds)
            : fetchedVideos;
        const skippedShorts = fetchedVideos.length - videos.length;
        const result = await insertOrUpdateVideos(videos);

        await markChannelSyncState(channelRow.id, {
            sync_status: 'completed',
            analysis_status: 'pending',
            last_sync_at: new Date(),
            last_error: `Fetched ${videos.length} videos (${result.added} new, ${result.updated} updated${skippedShorts ? `, skipped ${skippedShorts} shorts` : ''}). Analysis is pending for videos without summaries.`,
        });

        return {
            channel: resolved,
            fetched: fetchedVideos.length,
            imported: videos.length,
            skippedShorts,
            ...result,
        };
    } catch (err) {
        if (isAbortError(err) || signal?.aborted) {
            await markChannelSyncState(channelRow.id, {
                sync_status: 'idle',
                analysis_status: 'pending',
                last_error: 'Stopped by admin',
            });
            throw err;
        }
        await markChannelSyncState(channelRow.id, {
            sync_status: 'failed',
            analysis_status: 'failed',
            last_error: err.message || 'Channel sync failed',
        });
        throw err;
    }
}

async function runChannelSync(channelRow, rawUrl, options = {}) {
    try {
        const result = await syncChannelVideos(channelRow, rawUrl, options);
        if (typeof options.afterSync === 'function') {
            await options.afterSync({ channelRow, result });
        }
    } catch {
        // syncChannelVideos already recorded channel failure state.
    } finally {
        runningJobs.delete(String(channelRow.id));
    }
}

export function startChannelSync(channelRow, rawUrl, options = {}) {
    const key = String(channelRow.id);
    if (runningJobs.has(key)) return false;

    const job = runChannelSync(channelRow, rawUrl, options);
    runningJobs.set(key, job);
    job.catch(() => {});
    return true;
}

export function getRunningChannelJobs() {
    return Array.from(runningJobs.keys());
}
