import { insertOrUpdateVideos, markChannelSyncState } from './adminDb';

const runningJobs = new Map();
const runningMetadataJobs = new Map();

function getApiKey() {
    return process.env.YOUTUBE_API_KEY;
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

async function youtubeGet(path, params = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('YOUTUBE_API_KEY is not configured');
    }

    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    url.searchParams.set('key', apiKey);
    for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || `YouTube API failed (${response.status})`);
    }
    return payload;
}

async function resolveChannel(rawUrl) {
    const ref = extractChannelRef(rawUrl);
    let payload = null;

    if (ref.channelId) {
        payload = await youtubeGet('channels', {
            part: 'snippet,contentDetails',
            id: ref.channelId,
            maxResults: 1,
        });
    } else if (ref.handle) {
        payload = await youtubeGet('channels', {
            part: 'snippet,contentDetails',
            forHandle: ref.handle,
            maxResults: 1,
        });
    } else if (ref.username) {
        payload = await youtubeGet('channels', {
            part: 'snippet,contentDetails',
            forUsername: ref.username,
            maxResults: 1,
        });
    }

    if (!payload?.items?.length && ref.query) {
        const search = await youtubeGet('search', {
            part: 'snippet',
            q: ref.query,
            type: 'channel',
            maxResults: 1,
        });
        const channelId = search.items?.[0]?.snippet?.channelId;
        if (channelId) {
            payload = await youtubeGet('channels', {
                part: 'snippet,contentDetails',
                id: channelId,
                maxResults: 1,
            });
        }
    }

    const channel = payload?.items?.[0];
    if (!channel) {
        throw new Error('Khong tim thay kenh YouTube tu URL nay');
    }

    return {
        channelId: channel.id,
        channelName: channel.snippet?.title || channel.id,
        channelUrl: `https://www.youtube.com/channel/${channel.id}`,
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
    if (!channelRow?.channel_url || channelRow.channel_thumbnail) return false;
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

async function fetchPlaylistVideos(playlistId, channelName) {
    const playlistItems = [];
    let pageToken = null;

    do {
        const payload = await youtubeGet('playlistItems', {
            part: 'snippet,contentDetails',
            playlistId,
            maxResults: 50,
            pageToken,
        });
        playlistItems.push(...(payload.items || []));
        pageToken = payload.nextPageToken || null;
    } while (pageToken);

    const videos = [];
    for (let index = 0; index < playlistItems.length; index += 50) {
        const batch = playlistItems.slice(index, index + 50);
        const ids = batch
            .map((item) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId)
            .filter(Boolean);

        if (!ids.length) continue;

        const detail = await youtubeGet('videos', {
            part: 'snippet,statistics,contentDetails',
            id: ids.join(','),
            maxResults: 50,
        });

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

async function runChannelSync(channelRow, rawUrl) {
    await markChannelSyncState(channelRow.id, {
        sync_status: 'running',
        analysis_status: 'pending',
        last_error: null,
    });

    try {
        const resolved = await resolveChannel(rawUrl || channelRow.channel_url);
        if (!resolved.uploadsPlaylistId) {
            throw new Error('Khong tim thay uploads playlist cua kenh');
        }

        await markChannelSyncState(channelRow.id, {
            channel_id: resolved.channelId,
            channel_name: resolved.channelName,
            channel_url: resolved.channelUrl,
            channel_thumbnail: resolved.channelThumbnail,
        });

        const videos = await fetchPlaylistVideos(resolved.uploadsPlaylistId, resolved.channelName);
        const result = await insertOrUpdateVideos(videos);

        await markChannelSyncState(channelRow.id, {
            sync_status: 'completed',
            analysis_status: 'pending',
            last_sync_at: new Date(),
            last_error: `Fetched ${videos.length} videos (${result.added} new, ${result.updated} updated). Analysis is pending for videos without summaries.`,
        });
    } catch (err) {
        await markChannelSyncState(channelRow.id, {
            sync_status: 'failed',
            analysis_status: 'failed',
            last_error: err.message || 'Channel sync failed',
        });
    } finally {
        runningJobs.delete(String(channelRow.id));
    }
}

export function startChannelSync(channelRow, rawUrl) {
    const key = String(channelRow.id);
    if (runningJobs.has(key)) return false;

    const job = runChannelSync(channelRow, rawUrl);
    runningJobs.set(key, job);
    job.catch(() => {});
    return true;
}

export function getRunningChannelJobs() {
    return Array.from(runningJobs.keys());
}
