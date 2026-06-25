const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function trimUrlLikeText(value) {
    return String(value || '')
        .trim()
        .replace(/[)\].,;'"，。]+$/g, '');
}

export function getYouTubeId(rawUrl) {
    const cleaned = trimUrlLikeText(rawUrl);
    if (!cleaned) return null;

    const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

    try {
        const parsed = new URL(withProtocol);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const segments = parsed.pathname.split('/').filter(Boolean);

        if (host === 'youtu.be') {
            const id = segments[0];
            return YOUTUBE_ID_RE.test(id) ? id : null;
        }

        if (
            host === 'youtube.com' ||
            host === 'm.youtube.com' ||
            host === 'music.youtube.com' ||
            host === 'youtube-nocookie.com'
        ) {
            const queryId = parsed.searchParams.get('v');
            if (queryId && YOUTUBE_ID_RE.test(queryId)) return queryId;

            const idFromPath = ['shorts', 'embed', 'v'].includes(segments[0]) ? segments[1] : null;
            if (idFromPath && YOUTUBE_ID_RE.test(idFromPath)) return idFromPath;
        }
    } catch {
        // Fall through to regex fallback.
    }

    const match = cleaned.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/v\/)([A-Za-z0-9_-]{11})/i);
    return match?.[1] || null;
}

export function normalizeVideoUrl(rawUrl) {
    const cleaned = trimUrlLikeText(rawUrl);
    if (!cleaned) return null;

    const youtubeId = getYouTubeId(cleaned);
    if (youtubeId) {
        return {
            videoKey: `yt:${youtubeId}`,
            canonicalUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
            youtubeId,
        };
    }

    try {
        const parsed = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
        parsed.hash = '';
        parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

        for (const key of [...parsed.searchParams.keys()]) {
            const normalizedKey = key.toLowerCase();
            if (
                normalizedKey.startsWith('utm_') ||
                ['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'si', 'feature'].includes(normalizedKey)
            ) {
                parsed.searchParams.delete(key);
            }
        }

        parsed.searchParams.sort();
        const canonicalUrl = parsed.toString().replace(/\/$/, '');
        return {
            videoKey: `url:${canonicalUrl.toLowerCase()}`,
            canonicalUrl,
            youtubeId: null,
        };
    } catch {
        const canonicalUrl = cleaned.toLowerCase();
        return {
            videoKey: `url:${canonicalUrl}`,
            canonicalUrl: cleaned,
            youtubeId: null,
        };
    }
}

export function getVideoKey(rawUrl) {
    return normalizeVideoUrl(rawUrl)?.videoKey || null;
}

export function getThumbnailForVideoUrl(rawUrl) {
    const youtubeId = getYouTubeId(rawUrl);
    return youtubeId ? `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg` : '';
}

export function extractYouTubeUrls(text) {
    if (!text) return [];

    const matches = String(text).match(
        /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/[^\s<>"'`)\]}]+/gi
    ) || [];

    const seen = new Set();
    const urls = [];

    for (const match of matches) {
        const withProtocol = /^https?:\/\//i.test(match) ? match : `https://${match}`;
        const normalized = normalizeVideoUrl(withProtocol);
        if (!normalized || seen.has(normalized.videoKey)) continue;
        seen.add(normalized.videoKey);
        urls.push(normalized.canonicalUrl);
    }

    return urls;
}

