/**
 * Local PostgreSQL Database Module
 * 
 * Handles video data queries using a local PostgreSQL database.
 * Auth, search_history, and channel_sources remain on Supabase.
 */
import pg from 'pg';
const { Pool } = pg;

let pool = null;
let usageSchemaPromise = null;

function getDefaultDatabaseUrl() {
    const password = process.env.POSTGRES_PASSWORD || 'postgres';
    const user = process.env.POSTGRES_USER || 'postgres';
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = process.env.POSTGRES_PORT || '5432';
    const db = process.env.POSTGRES_APP_DB || process.env.POSTGRES_DB || 'deep_searching';
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

export function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.LOCAL_DATABASE_URL || getDefaultDatabaseUrl(),
        });
        pool.on('error', (err) => {
            console.error('❌ PostgreSQL pool error:', err);
        });
    }
    return pool;
}

export async function ensureUsageSchema() {
    if (!usageSchemaPromise) {
        usageSchemaPromise = (async () => {
            const db = getPool();

            await db.query(`ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_key TEXT`);

            await db.query(`
                UPDATE videos
                SET video_key = CASE
                    WHEN url ~* 'youtu\\.be/[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM 'youtu\\.be/([A-Za-z0-9_-]{11})')
                    WHEN url ~* '/shorts/[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM '/shorts/([A-Za-z0-9_-]{11})')
                    WHEN url ~* '/embed/[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM '/embed/([A-Za-z0-9_-]{11})')
                    WHEN url ~* '/v/[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM '/v/([A-Za-z0-9_-]{11})')
                    WHEN url ~* '[?&]v=[A-Za-z0-9_-]{11}' THEN 'yt:' || substring(url FROM '[?&]v=([A-Za-z0-9_-]{11})')
                    ELSE 'url:' || lower(split_part(url, '#', 1))
                END
                WHERE video_key IS NULL OR video_key = ''
            `);

            await db.query(`CREATE INDEX IF NOT EXISTS idx_videos_video_key ON videos(video_key)`);

            await db.query(`
                CREATE TABLE IF NOT EXISTS usage_profiles (
                    id BIGSERIAL PRIMARY KEY,
                    user_email TEXT NOT NULL,
                    name TEXT NOT NULL,
                    google_sheet_url TEXT NOT NULL,
                    tab_scope TEXT NOT NULL DEFAULT 'current',
                    last_sync_at TIMESTAMPTZ,
                    sync_status TEXT NOT NULL DEFAULT 'idle',
                    sync_error TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);

            await db.query(`ALTER TABLE usage_profiles ADD COLUMN IF NOT EXISTS tab_scope TEXT NOT NULL DEFAULT 'current'`);

            await db.query(`
                CREATE TABLE IF NOT EXISTS profile_used_videos (
                    id BIGSERIAL PRIMARY KEY,
                    profile_id BIGINT NOT NULL REFERENCES usage_profiles(id) ON DELETE CASCADE,
                    video_key TEXT NOT NULL,
                    url TEXT NOT NULL,
                    title TEXT,
                    thumbnail TEXT,
                    occurrences JSONB NOT NULL DEFAULT '[]'::jsonb,
                    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(profile_id, video_key)
                )
            `);

            await db.query(`
                CREATE TABLE IF NOT EXISTS profile_doc_syncs (
                    id BIGSERIAL PRIMARY KEY,
                    profile_id BIGINT NOT NULL REFERENCES usage_profiles(id) ON DELETE CASCADE,
                    doc_id TEXT NOT NULL,
                    doc_url TEXT NOT NULL,
                    title TEXT,
                    modified_time TIMESTAMPTZ,
                    videos JSONB NOT NULL DEFAULT '[]'::jsonb,
                    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_error TEXT,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(profile_id, doc_id)
                )
            `);

            await db.query(`
                CREATE TABLE IF NOT EXISTS usage_user_settings (
                    user_email TEXT PRIMARY KEY,
                    active_profile_id BIGINT REFERENCES usage_profiles(id) ON DELETE SET NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);

            await db.query(`CREATE INDEX IF NOT EXISTS idx_usage_profiles_user_email ON usage_profiles(user_email)`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_used_videos_profile_id ON profile_used_videos(profile_id)`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_used_videos_video_key ON profile_used_videos(video_key)`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_used_videos_url ON profile_used_videos(url)`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_doc_syncs_profile_id ON profile_doc_syncs(profile_id)`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_doc_syncs_doc_id ON profile_doc_syncs(doc_id)`);

            await db.query(`
                CREATE TABLE IF NOT EXISTS channel_sources (
                    id BIGSERIAL PRIMARY KEY,
                    channel_id TEXT UNIQUE,
                    channel_name TEXT NOT NULL,
                    channel_url TEXT,
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
            await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS channel_thumbnail TEXT`);
            await db.query(`ALTER TABLE channel_sources ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_channel_sources_hidden ON channel_sources(hidden)`);
        })().catch((err) => {
            usageSchemaPromise = null;
            throw err;
        });
    }

    return usageSchemaPromise;
}

function appendUsedPredicate(params, profileId, userEmail) {
    const profileParam = params.length + 1;
    params.push(profileId);
    const emailParam = params.length + 1;
    params.push(userEmail);

    return `
        EXISTS (
            SELECT 1
            FROM profile_used_videos pu
            INNER JOIN usage_profiles up ON up.id = pu.profile_id
            WHERE pu.profile_id = $${profileParam}
              AND up.user_email = $${emailParam}
              AND (
                (videos.video_key IS NOT NULL AND pu.video_key = videos.video_key)
                OR pu.url = videos.url
              )
        )
    `;
}

const MAX_ADVANCED_GROUPS = 3;
const MAX_ADVANCED_TERMS_PER_GROUP = 8;
const MAX_ADVANCED_TERM_LENGTH = 64;
const LEXEME_CACHE_TTL = 10 * 60 * 1000;
const LEXEME_LIMIT = 20000;
const BROAD_FACET_THRESHOLD_RATIO = 0.25;
const BROAD_FACET_WEIGHT = 0.4;
const lexemeCache = new Map();

export const DOMAIN_GENERIC_SEARCH_TERMS = [
    'police',
    'cop',
    'cops',
    'officer',
    'bodycam',
    'body cam',
    'body camera',
    'arrest',
    'arrested',
    'arresting',
    'detained',
    'detention',
    'custody',
    'handcuffed',
    'cuffed',
];

function normalizeSearchTerm(term) {
    return String(term || '')
        .trim()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, MAX_ADVANCED_TERM_LENGTH)
        .trim();
}

function termToTsQuery(term) {
    const safeTerm = normalizeSearchTerm(term);
    const words = safeTerm.split(/\s+/).filter(Boolean);

    if (words.length === 0) return null;
    if (words.length > 1) return `(${words.join(' <-> ')})`;
    return words[0];
}

function getTermWords(term) {
    return normalizeSearchTerm(term)
        .toLowerCase()
        .split(/\s+/)
        .map(word => word.trim())
        .filter(word => word.length >= 2);
}

function normalizeStopwordTerm(term) {
    return normalizeSearchTerm(term).toLowerCase();
}

const DOMAIN_GENERIC_SEARCH_TERM_SET = new Set(DOMAIN_GENERIC_SEARCH_TERMS.map(normalizeStopwordTerm));
const DOMAIN_GENERIC_SEARCH_WORD_SET = new Set(
    DOMAIN_GENERIC_SEARCH_TERMS.flatMap(term => getTermWords(term))
);

export function isDomainGenericSearchTerm(term) {
    const normalizedTerm = normalizeStopwordTerm(term);
    if (!normalizedTerm) return false;
    if (DOMAIN_GENERIC_SEARCH_TERM_SET.has(normalizedTerm)) return true;

    const words = getTermWords(normalizedTerm);
    return words.length > 1 && words.every(word => DOMAIN_GENERIC_SEARCH_WORD_SET.has(word));
}

function normalizeOperator(operator, fallback = 'OR') {
    const value = String(operator || fallback).trim().toUpperCase();
    if (value === 'AND' || value === 'OR') return value;
    return String(fallback).trim().toUpperCase() === 'AND' ? 'AND' : 'OR';
}

export function normalizeAdvancedSearchPlan(plan) {
    let rawPlan = plan;
    if (typeof rawPlan === 'string') {
        try {
            rawPlan = JSON.parse(rawPlan);
        } catch {
            return null;
        }
    }

    const rawGroups = Array.isArray(rawPlan?.groups) ? rawPlan.groups : [];
    const groups = rawGroups
        .slice(0, MAX_ADVANCED_GROUPS)
        .map(group => {
            const terms = Array.isArray(group?.terms)
                ? group.terms
                    .map(normalizeSearchTerm)
                    .filter(Boolean)
                    .filter((term, index, arr) => arr.indexOf(term) === index)
                    .slice(0, MAX_ADVANCED_TERMS_PER_GROUP)
                : [];

            return {
                operator: normalizeOperator(group?.operator, 'OR'),
                terms,
            };
        })
        .filter(group => group.terms.length > 0);

    if (groups.length === 0) return null;

    return {
        rootOperator: normalizeOperator(rawPlan?.rootOperator, 'AND'),
        groups,
    };
}

export function filterDomainGenericTermsFromPlan(plan) {
    const normalizedPlan = normalizeAdvancedSearchPlan(plan);

    if (!normalizedPlan) {
        return {
            plan: null,
            droppedTerms: [],
            droppedFacets: [],
            unmatchedFacets: [],
        };
    }

    const droppedTerms = [];
    const droppedFacets = [];
    const groups = normalizedPlan.groups
        .map((group, groupIndex) => {
            const keptTerms = [];
            const groupDroppedTerms = [];

            for (const term of group.terms) {
                if (isDomainGenericSearchTerm(term)) {
                    groupDroppedTerms.push(term);
                    droppedTerms.push({ groupIndex, term, reason: 'domain_generic' });
                } else {
                    keptTerms.push(term);
                }
            }

            if (keptTerms.length === 0) {
                droppedFacets.push({
                    groupIndex,
                    operator: group.operator,
                    terms: group.terms,
                    droppedTerms: groupDroppedTerms,
                    reason: 'domain_generic',
                });
                return null;
            }

            return {
                operator: group.operator,
                terms: keptTerms,
            };
        })
        .filter(Boolean);

    return {
        plan: groups.length > 0 ? { rootOperator: normalizedPlan.rootOperator, groups } : null,
        droppedTerms,
        droppedFacets,
        unmatchedFacets: droppedFacets,
    };
}

function normalizeLexemeDictionary(dictionary) {
    if (!dictionary) {
        return { words: new Map() };
    }

    if (dictionary instanceof Set) {
        return {
            words: new Map(Array.from(dictionary).map(word => [String(word).toLowerCase(), 1])),
        };
    }

    if (dictionary instanceof Map) {
        return { words: dictionary };
    }

    if (dictionary.words instanceof Map) {
        return dictionary;
    }

    if (dictionary.words instanceof Set) {
        return normalizeLexemeDictionary(dictionary.words);
    }

    if (Array.isArray(dictionary.words)) {
        return {
            words: new Map(dictionary.words.map(item => {
                if (Array.isArray(item)) return [String(item[0]).toLowerCase(), Number(item[1] || 1)];
                if (typeof item === 'object') return [String(item.word || '').toLowerCase(), Number(item.nentry || item.count || 1)];
                return [String(item).toLowerCase(), 1];
            }).filter(([word]) => word)),
        };
    }

    return { words: new Map() };
}

function termExistsInCorpus(term, dictionary) {
    const lexemes = normalizeLexemeDictionary(dictionary).words;
    const words = getTermWords(term);
    if (words.length === 0) return false;
    return words.every(word => lexemes.has(word));
}

function estimateTermCorpusCount(term, dictionary) {
    const lexemes = normalizeLexemeDictionary(dictionary).words;
    const words = getTermWords(term);
    if (words.length === 0) return 0;
    return Math.min(...words.map(word => Number(lexemes.get(word) || 0)));
}

export function validateAdvancedSearchPlanWithCorpus(plan, dictionary) {
    const normalizedPlan = normalizeAdvancedSearchPlan(plan);
    const lexemes = normalizeLexemeDictionary(dictionary);

    if (!normalizedPlan) {
        return {
            plan: null,
            droppedFacets: [],
            droppedTerms: [],
            unmatchedFacets: [],
            facetLexemeCounts: [],
        };
    }

    const droppedFacets = [];
    const droppedTerms = [];
    const unmatchedFacets = [];
    const facetLexemeCounts = [];

    const groups = normalizedPlan.groups
        .map((group, groupIndex) => {
            const keptTerms = [];
            const groupDroppedTerms = [];

            for (const term of group.terms) {
                if (isDomainGenericSearchTerm(term)) {
                    groupDroppedTerms.push(term);
                    droppedTerms.push({ groupIndex, term, reason: 'domain_generic' });
                    continue;
                }

                if (termExistsInCorpus(term, lexemes)) {
                    keptTerms.push(term);
                } else {
                    groupDroppedTerms.push(term);
                    droppedTerms.push({ groupIndex, term, reason: 'not_in_corpus' });
                }
            }

            const facetCount = keptTerms.reduce((sum, term) => sum + estimateTermCorpusCount(term, lexemes), 0);
            facetLexemeCounts.push(facetCount);

            if (keptTerms.length === 0) {
                const facet = {
                    groupIndex,
                    operator: group.operator,
                    terms: group.terms,
                    droppedTerms: groupDroppedTerms,
                    reason: groupDroppedTerms.every(isDomainGenericSearchTerm) ? 'domain_generic' : 'unmatched_corpus',
                };
                droppedFacets.push(facet);
                unmatchedFacets.push(facet);
                return null;
            }

            return {
                operator: group.operator,
                terms: keptTerms,
            };
        })
        .filter(Boolean);

    return {
        plan: groups.length > 0 ? { rootOperator: normalizedPlan.rootOperator, groups } : null,
        originalPlan: normalizedPlan,
        droppedFacets,
        droppedTerms,
        unmatchedFacets,
        facetLexemeCounts,
    };
}

export function analyzeAdvancedFacetWeights(plan, dictionary) {
    const normalizedPlan = normalizeAdvancedSearchPlan(plan);
    const lexemes = normalizeLexemeDictionary(dictionary).words;
    const totalVideos = Math.max(Number(dictionary?.totalVideos || 0), 1);

    if (!normalizedPlan) {
        return {
            broadFacets: [],
            facetWeights: [],
            facetTermCounts: [],
        };
    }

    const broadFacets = [];
    const facetWeights = [];
    const facetTermCounts = [];

    normalizedPlan.groups.forEach((group, groupIndex) => {
        const termCounts = group.terms.map(term => ({
            term,
            count: estimateTermCorpusCount(term, { words: lexemes }),
        }));
        const usableCounts = termCounts.filter(item => item.count > 0);
        const isBroad = usableCounts.length > 0 && usableCounts.every(item => item.count / totalVideos >= BROAD_FACET_THRESHOLD_RATIO);

        facetTermCounts.push(termCounts);
        facetWeights.push(isBroad ? BROAD_FACET_WEIGHT : 1);

        if (isBroad) {
            broadFacets.push({
                groupIndex,
                terms: group.terms,
                label: group.terms.join('|'),
                threshold_ratio: BROAD_FACET_THRESHOLD_RATIO,
                weight: BROAD_FACET_WEIGHT,
                term_counts: termCounts,
            });
        }
    });

    return {
        broadFacets,
        facetWeights,
        facetTermCounts,
        totalVideos,
    };
}

export function buildAdvancedSearchTsQuery(plan) {
    const normalizedPlan = normalizeAdvancedSearchPlan(plan);
    if (!normalizedPlan) return null;

    const groupQueries = normalizedPlan.groups
        .map(group => {
            const termQueries = group.terms.map(termToTsQuery).filter(Boolean);
            if (termQueries.length === 0) return null;

            const operator = group.operator === 'AND' ? ' & ' : ' | ';
            const query = termQueries.join(operator);
            return termQueries.length > 1 ? `(${query})` : query;
        })
        .filter(Boolean);

    if (groupQueries.length === 0) return null;

    const rootOperator = normalizedPlan.rootOperator === 'OR' ? ' | ' : ' & ';
    return groupQueries.join(rootOperator);
}

export function buildRelaxedAdvancedSearchTsQuery(plan) {
    const normalizedPlan = normalizeAdvancedSearchPlan(plan);
    if (!normalizedPlan) return null;

    const groupQueries = normalizedPlan.groups
        .map(group => {
            const relaxedTerms = group.terms
                .flatMap(term => {
                    const phraseQuery = termToTsQuery(term);
                    const words = normalizeSearchTerm(term)
                        .split(/\s+/)
                        .map(word => word.trim())
                        .filter(word => word.length >= 2);
                    return [phraseQuery, ...words].filter(Boolean);
                })
                .filter((term, index, arr) => arr.indexOf(term) === index)
                .slice(0, 16);

            if (relaxedTerms.length === 0) return null;
            return relaxedTerms.length > 1 ? `(${relaxedTerms.join(' | ')})` : relaxedTerms[0];
        })
        .filter(Boolean);

    if (groupQueries.length === 0) return null;

    const rootOperator = normalizedPlan.rootOperator === 'OR' ? ' | ' : ' & ';
    return groupQueries.join(rootOperator);
}

export function buildOptionalAdvancedSearchTsQuery(plan) {
    const normalizedPlan = normalizeAdvancedSearchPlan(plan);
    if (!normalizedPlan) return null;

    const groupQueries = normalizedPlan.groups
        .map(group => {
            const termQueries = group.terms.map(termToTsQuery).filter(Boolean);
            if (termQueries.length === 0) return null;
            const operator = group.operator === 'AND' ? ' & ' : ' | ';
            const query = termQueries.join(operator);
            return termQueries.length > 1 ? `(${query})` : query;
        })
        .filter(Boolean);

    if (groupQueries.length === 0) return null;
    return groupQueries.join(' | ');
}

export function dropWeakestAdvancedFacet(plan, facetMatchCounts = []) {
    const normalizedPlan = normalizeAdvancedSearchPlan(plan);
    if (!normalizedPlan || normalizedPlan.groups.length <= 1) return null;

    const scoredGroups = normalizedPlan.groups.map((group, index) => ({
        group,
        index,
        score: Number.isFinite(Number(facetMatchCounts[index])) ? Number(facetMatchCounts[index]) : Number.MAX_SAFE_INTEGER,
        termCount: group.terms.length,
    }));

    scoredGroups.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.termCount - b.termCount;
    });

    const dropped = scoredGroups[0];
    const groups = normalizedPlan.groups.filter((_, index) => index !== dropped.index);
    if (groups.length === 0) return null;

    return {
        plan: {
            rootOperator: groups.length > 1 ? normalizedPlan.rootOperator : 'OR',
            groups,
        },
        droppedFacet: {
            groupIndex: dropped.index,
            operator: dropped.group.operator,
            terms: dropped.group.terms,
            reason: 'weakest_facet_after_zero_results',
        },
    };
}

function buildKeywordSearchTsQuery(query, mode) {
    const safeQuery = query.trim().replace(/[^\p{L}\p{N}\s,]/gu, '');
    const tags = safeQuery.split(',').map(t => t.trim()).filter(t => t);

    const tagQueries = tags.map(termToTsQuery).filter(Boolean);
    if (tagQueries.length === 0) return null;

    const operator = mode === 'and' ? ' & ' : ' | ';
    return tagQueries.join(operator);
}

function getSafeFtsColumn(ftsColumn) {
    return ftsColumn === 'fts' ? 'fts' : 'fts_no_caption';
}

export async function getSearchLexemeDictionary(ftsColumn = 'fts_no_caption') {
    const safeColumn = getSafeFtsColumn(ftsColumn);
    const cacheKey = safeColumn;
    const cached = lexemeCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < LEXEME_CACHE_TTL) {
        return cached.dictionary;
    }

    const db = getPool();
    const [result, totalResult] = await Promise.all([
        db.query(
        `SELECT word, nentry
         FROM ts_stat('SELECT ${safeColumn} FROM videos')
         WHERE length(word) >= 2
         ORDER BY nentry DESC
         LIMIT $1`,
        [LEXEME_LIMIT]
        ),
        db.query(`SELECT COUNT(*)::INT AS total FROM videos`),
    ]);

    const words = new Map(
        result.rows
            .map(row => [String(row.word || '').toLowerCase(), Number(row.nentry || 0)])
            .filter(([word]) => word)
    );
    const dictionary = {
        ftsColumn: safeColumn,
        words,
        totalVideos: Number(totalResult.rows[0]?.total || 0),
        topTerms: result.rows.slice(0, 120).map(row => ({
            word: String(row.word || ''),
            count: Number(row.nentry || 0),
        })),
    };

    lexemeCache.set(cacheKey, { timestamp: now, dictionary });
    return dictionary;
}

export async function getTopSearchLexemes(limit = 80, ftsColumn = 'fts_no_caption') {
    const dictionary = await getSearchLexemeDictionary(ftsColumn);
    return dictionary.topTerms.slice(0, limit);
}

/**
 * Query videos with search, pagination, sorting, and advanced filters.
 * Mirrors the Supabase query logic from the original /api/data/route.js
 */
export async function queryVideos({
    query = null,
    page = 1,
    pageSize = 50,
    sortBy = 'created_at',
    sortOrder = 'desc',
    mode = 'or',
    minViews = null,
    maxViews = null,
    startDate = null,
    endDate = null,
    channels = null,
    captionSearch = false,
    profileId = null,
    userEmail = null,
    hideUsed = false,
    advancedQuery = null,
} = {}) {
    await ensureUsageSchema();
    const db = getPool();

    // Map sort column names
    const columnMap = {
        'title': 'title',
        'url': 'url',
        'views': 'views',
        'date published': 'date_published',
        'date_published': 'date_published',
        'channel name': 'channel_name',
        'channel_name': 'channel_name',
        'created_at': 'created_at',
        'created at': 'created_at',
        'thumbnail': 'thumbnail',
        'summary': 'summary',
    };

    const normalizedSortBy = String(sortBy).toLowerCase().trim();
    const isRelevanceSort = normalizedSortBy === 'relevance';
    const dbSortColumn = columnMap[normalizedSortBy] || 'created_at';
    const isDescending = String(sortOrder).toLowerCase() === 'desc';
    const offset = (page - 1) * pageSize;

    // Build WHERE conditions
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    conditions.push(`
        NOT EXISTS (
            SELECT 1
            FROM channel_sources cs
            WHERE cs.hidden IS TRUE
              AND lower(cs.channel_name) = lower(videos.channel_name)
        )
    `);

    // Full-Text Search
    const ftsColumn = captionSearch ? 'fts' : 'fts_no_caption';
    let ftsParamPosition = -1;
    let ftsQuery = null;
    let relaxedAdvancedTsQuery = null;
    let advancedEffectivePlan = null;
    let advancedSearchMeta = null;
    let facetRankingQueries = [];
    let facetRankingWeights = [];

    if ((query && query.trim()) || (mode === 'advanced' && advancedQuery)) {
        if (mode === 'advanced' && advancedQuery) {
            const normalizedAdvancedPlan = normalizeAdvancedSearchPlan(advancedQuery);
            let validation = {
                plan: normalizedAdvancedPlan,
                originalPlan: normalizedAdvancedPlan,
                droppedFacets: [],
                droppedTerms: [],
                unmatchedFacets: [],
                facetLexemeCounts: [],
            };
            let corpusValidationError = null;

            try {
                const dictionary = await getSearchLexemeDictionary(ftsColumn);
                validation = validateAdvancedSearchPlanWithCorpus(normalizedAdvancedPlan, dictionary);
                const facetWeightInfo = analyzeAdvancedFacetWeights(validation.plan || normalizedAdvancedPlan, dictionary);
                facetRankingWeights = facetWeightInfo.facetWeights;
                facetRankingQueries = (validation.plan || normalizedAdvancedPlan)?.groups?.map(group => buildAdvancedSearchTsQuery({ rootOperator: 'AND', groups: [group] })) || [];
                advancedSearchMeta = {
                    mode: 'advanced',
                    fts_column: ftsColumn,
                    strict_total: null,
                    relaxed: false,
                    strategy: null,
                    effective_query: null,
                    relaxed_query: null,
                    original_plan: validation.originalPlan || normalizedAdvancedPlan,
                    validated_plan: validation.plan || normalizedAdvancedPlan,
                    dropped_facets: validation.droppedFacets || [],
                    dropped_terms: validation.droppedTerms || [],
                    unmatched_facets: validation.unmatchedFacets || [],
                    facet_lexeme_counts: validation.facetLexemeCounts || [],
                    facet_match_counts: [],
                    corpus_validation_error: null,
                    broad_facets: facetWeightInfo.broadFacets.map(facet => facet.label),
                    broad_facet_details: facetWeightInfo.broadFacets,
                    facet_weights: facetWeightInfo.facetWeights,
                    facet_term_counts: facetWeightInfo.facetTermCounts,
                    total_videos: facetWeightInfo.totalVideos,
                    sort_strategy: isRelevanceSort ? 'relevance' : normalizedSortBy,
                    rank_applied: false,
                };
            } catch (error) {
                corpusValidationError = error.message;
            }

            advancedEffectivePlan = validation.plan || normalizedAdvancedPlan;
            ftsQuery = buildAdvancedSearchTsQuery(advancedEffectivePlan);
            relaxedAdvancedTsQuery = buildRelaxedAdvancedSearchTsQuery(advancedEffectivePlan);
            if (!advancedSearchMeta) {
                facetRankingWeights = advancedEffectivePlan?.groups?.map(() => 1) || [];
                facetRankingQueries = advancedEffectivePlan?.groups?.map(group => buildAdvancedSearchTsQuery({ rootOperator: 'AND', groups: [group] })) || [];
                advancedSearchMeta = {
                    mode: 'advanced',
                    fts_column: ftsColumn,
                    strict_total: null,
                    relaxed: false,
                    strategy: ftsQuery ? 'strict' : 'no_query',
                    effective_query: ftsQuery,
                    relaxed_query: relaxedAdvancedTsQuery,
                    original_plan: validation.originalPlan || normalizedAdvancedPlan,
                    validated_plan: advancedEffectivePlan,
                    dropped_facets: validation.droppedFacets || [],
                    dropped_terms: validation.droppedTerms || [],
                    unmatched_facets: validation.unmatchedFacets || [],
                    facet_lexeme_counts: validation.facetLexemeCounts || [],
                    facet_match_counts: [],
                    corpus_validation_error: corpusValidationError,
                    broad_facets: [],
                    facet_weights: facetRankingWeights,
                    facet_term_counts: [],
                    sort_strategy: isRelevanceSort ? 'relevance' : normalizedSortBy,
                    rank_applied: false,
                };
            } else {
                advancedSearchMeta.strategy = ftsQuery ? 'strict' : 'no_query';
                advancedSearchMeta.effective_query = ftsQuery;
                advancedSearchMeta.relaxed_query = relaxedAdvancedTsQuery;
                advancedSearchMeta.validated_plan = advancedEffectivePlan;
                advancedSearchMeta.corpus_validation_error = corpusValidationError;
            }
        } else {
            ftsQuery = query?.trim() ? buildKeywordSearchTsQuery(query, mode) : null;
        }
    }

    // Advanced filters
    if (minViews !== null) {
        conditions.push(`views >= $${paramIndex}`);
        params.push(minViews);
        paramIndex++;
    }
    if (maxViews !== null) {
        conditions.push(`views <= $${paramIndex}`);
        params.push(maxViews);
        paramIndex++;
    }
    if (startDate) {
        conditions.push(`date_published >= $${paramIndex}`);
        params.push(startDate);
        paramIndex++;
    }
    if (endDate) {
        conditions.push(`date_published <= $${paramIndex}`);
        params.push(endDate);
        paramIndex++;
    }
    if (channels) {
        const channelList = channels.split(',').map(c => c.trim()).filter(c => c);
        if (channelList.length > 0) {
            conditions.push(`channel_name = ANY($${paramIndex})`);
            params.push(channelList);
            paramIndex++;
        }
    }

    const rankCanApply = Boolean(ftsQuery);
    const relevanceSortActive = isRelevanceSort && rankCanApply;
    const defaultOrderClause = `ORDER BY ${dbSortColumn} ${isDescending ? 'DESC' : 'ASC'} NULLS LAST`;
    const canUseProfileFilter = Boolean(profileId && userEmail);
    const baseSearchConditions = [...conditions];
    const baseSearchParams = [...params];

    try {
        const countWithSearch = async (searchTsQuery, sourceConditions = baseSearchConditions, sourceParams = baseSearchParams) => {
            const countParams = [...sourceParams];
            const countConditions = [...sourceConditions];
            if (searchTsQuery) {
                countConditions.push(`${ftsColumn} @@ to_tsquery('simple', $${countParams.length + 1})`);
                countParams.push(searchTsQuery);
            }
            if (canUseProfileFilter && hideUsed) {
                countConditions.push(`NOT ${appendUsedPredicate(countParams, profileId, userEmail)}`);
            }
            const countWhereClause = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';
            const countSql = `SELECT COUNT(*) as total FROM videos ${countWhereClause}`;
            const countResult = await db.query(countSql, countParams);
            return parseInt(countResult.rows[0].total, 10);
        };

        if (advancedSearchMeta?.validated_plan?.groups?.length) {
            advancedSearchMeta.facet_match_counts = [];
            for (const group of advancedSearchMeta.validated_plan.groups) {
                const facetQuery = buildAdvancedSearchTsQuery({ rootOperator: 'AND', groups: [group] });
                advancedSearchMeta.facet_match_counts.push(facetQuery ? await countWithSearch(facetQuery) : 0);
            }
        }

        if (ftsQuery) {
            conditions.push(`${ftsColumn} @@ to_tsquery('simple', $${paramIndex})`);
            ftsParamPosition = params.length;
            params.push(ftsQuery);
            paramIndex++;
        }

        if (advancedSearchMeta) {
            advancedSearchMeta.sort_strategy = relevanceSortActive ? 'relevance' : normalizedSortBy;
            advancedSearchMeta.rank_applied = relevanceSortActive;
        }

        const runVideoQuery = async (baseParams) => {
            // Count query
            const countParams = [...baseParams];
            const countConditions = [...conditions];
            if (canUseProfileFilter && hideUsed) {
                countConditions.push(`NOT ${appendUsedPredicate(countParams, profileId, userEmail)}`);
            }
            const countWhereClause = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';
            const countSql = `SELECT COUNT(*) as total FROM videos ${countWhereClause}`;
            const countResult = await db.query(countSql, countParams);
            const totalCount = parseInt(countResult.rows[0].total, 10);

            // Data query
            const dataParams = [...baseParams];
            const dataConditions = [...conditions];
            let usedSelect = `FALSE AS is_used`;
            const rankSelect = ftsParamPosition >= 0
                ? `ts_rank_cd(${ftsColumn}, to_tsquery('simple', $${ftsParamPosition + 1})) AS search_rank`
                : `0::REAL AS search_rank`;
            const facetScoreParts = [];
            const facetTitleScoreParts = [];

            if (mode === 'advanced' && facetRankingQueries.length > 0) {
                facetRankingQueries.forEach((facetQuery, index) => {
                    if (!facetQuery) return;
                    dataParams.push(facetQuery);
                    const facetParam = dataParams.length;
                    const weight = Number(facetRankingWeights[index] || 1);
                    const captionWeight = Math.max(Number((weight * 0.35).toFixed(3)), 0.1);
                    const titleWeight = Number((weight * 2).toFixed(3));
                    facetScoreParts.push(`
                        CASE
                            WHEN to_tsvector('simple', coalesce(title, '')) @@ to_tsquery('simple', $${facetParam}) THEN ${titleWeight}
                            WHEN to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(channel_name, '')) @@ to_tsquery('simple', $${facetParam}) THEN ${weight}
                            ${captionSearch ? `WHEN to_tsvector('simple', coalesce(caption, '')) @@ to_tsquery('simple', $${facetParam}) THEN ${captionWeight}` : ''}
                            ELSE 0
                        END
                    `);
                    facetTitleScoreParts.push(`
                        CASE
                            WHEN to_tsvector('simple', coalesce(title, '')) @@ to_tsquery('simple', $${facetParam}) THEN ${weight}
                            ELSE 0
                        END
                    `);
                });
            }

            const facetScoreSelect = facetScoreParts.length > 0
                ? `(${facetScoreParts.join(' + ')})::REAL AS facet_score`
                : `0::REAL AS facet_score`;
            const facetTitleScoreSelect = facetTitleScoreParts.length > 0
                ? `(${facetTitleScoreParts.join(' + ')})::REAL AS facet_title_score`
                : `0::REAL AS facet_title_score`;
            const activeOrderClause = relevanceSortActive
                ? `ORDER BY ${mode === 'advanced' ? 'facet_title_score DESC, facet_score DESC, ' : ''}search_rank DESC, date_published DESC NULLS LAST`
                : defaultOrderClause;

            if (canUseProfileFilter) {
                if (hideUsed) {
                    dataConditions.push(`NOT ${appendUsedPredicate(dataParams, profileId, userEmail)}`);
                } else {
                    usedSelect = `${appendUsedPredicate(dataParams, profileId, userEmail)} AS is_used`;
                }
            }

            const dataWhereClause = dataConditions.length > 0 ? `WHERE ${dataConditions.join(' AND ')}` : '';
            const limitParam = dataParams.length + 1;
            const offsetParam = dataParams.length + 2;

            const dataSql = `
                SELECT
                    title,
                    url,
                    channel_name,
                    views,
                    date_published,
                    thumbnail,
                    created_at,
                    summary,
                    video_key,
                    COALESCE((
                        SELECT cs.status
                        FROM channel_sources cs
                        WHERE lower(btrim(cs.channel_name)) = lower(btrim(videos.channel_name))
                        ORDER BY CASE WHEN cs.status = 'copyright' THEN 0 ELSE 1 END
                        LIMIT 1
                    ), 'normal') AS channel_status,
                    ${rankSelect},
                    ${facetScoreSelect},
                    ${facetTitleScoreSelect},
                    ${usedSelect}
                FROM videos
                ${dataWhereClause}
                ${activeOrderClause}
                LIMIT $${limitParam} OFFSET $${offsetParam}
            `;
            dataParams.push(pageSize, offset);

            const dataResult = await db.query(dataSql, dataParams);
            return { rows: dataResult.rows, totalCount };
        };

        let result = await runVideoQuery(params);
        if (advancedSearchMeta) {
            advancedSearchMeta.strict_total = result.totalCount;
        }

        const canRelaxAdvancedSearch = (
            mode === 'advanced'
            && ftsParamPosition >= 0
            && relaxedAdvancedTsQuery
            && relaxedAdvancedTsQuery !== params[ftsParamPosition]
            && result.totalCount === 0
        );

        if (canRelaxAdvancedSearch) {
            const relaxedParams = [...params];
            relaxedParams[ftsParamPosition] = relaxedAdvancedTsQuery;
            result = await runVideoQuery(relaxedParams);
            if (advancedSearchMeta) {
                advancedSearchMeta.relaxed = true;
                advancedSearchMeta.strategy = 'relaxed_phrase';
                advancedSearchMeta.effective_query = relaxedAdvancedTsQuery;
                advancedSearchMeta.relaxed_total = result.totalCount;
            }
        }

        const reducedCandidate = advancedEffectivePlan?.groups?.length > 2
            ? dropWeakestAdvancedFacet(advancedEffectivePlan, advancedSearchMeta?.facet_match_counts || [])
            : null;
        if (mode === 'advanced' && result.totalCount === 0 && ftsParamPosition >= 0 && reducedCandidate?.plan) {
            const reducedTsQuery = buildRelaxedAdvancedSearchTsQuery(reducedCandidate.plan) || buildAdvancedSearchTsQuery(reducedCandidate.plan);
            if (reducedTsQuery && reducedTsQuery !== params[ftsParamPosition]) {
                const reducedParams = [...params];
                reducedParams[ftsParamPosition] = reducedTsQuery;
                const reducedResult = await runVideoQuery(reducedParams);
                if (advancedSearchMeta) {
                    advancedSearchMeta.reduced_query = reducedTsQuery;
                    advancedSearchMeta.reduced_total = reducedResult.totalCount;
                    advancedSearchMeta.reduced_dropped_facet = reducedCandidate.droppedFacet;
                }
                if (reducedResult.totalCount > 0) {
                    result = reducedResult;
                    if (advancedSearchMeta) {
                        advancedSearchMeta.relaxed = true;
                        advancedSearchMeta.strategy = 'drop_weakest_facet';
                        advancedSearchMeta.effective_query = reducedTsQuery;
                        advancedSearchMeta.dropped_facets = [
                            ...(advancedSearchMeta.dropped_facets || []),
                            reducedCandidate.droppedFacet,
                        ];
                    }
                }
            }
        }

        if (mode === 'advanced' && result.totalCount === 0 && ftsParamPosition >= 0 && advancedEffectivePlan?.groups?.length > 1) {
            const optionalTsQuery = buildOptionalAdvancedSearchTsQuery(advancedEffectivePlan);
            if (optionalTsQuery && optionalTsQuery !== params[ftsParamPosition]) {
                const optionalParams = [...params];
                optionalParams[ftsParamPosition] = optionalTsQuery;
                const optionalResult = await runVideoQuery(optionalParams);
                if (advancedSearchMeta) {
                    advancedSearchMeta.optional_query = optionalTsQuery;
                    advancedSearchMeta.optional_total = optionalResult.totalCount;
                }
                if (optionalResult.totalCount > 0) {
                    result = optionalResult;
                    if (advancedSearchMeta) {
                        advancedSearchMeta.relaxed = true;
                        advancedSearchMeta.strategy = 'optional_or';
                        advancedSearchMeta.effective_query = optionalTsQuery;
                    }
                }
            }
        }

        const formatted = result.rows.map(r => ({
            'Title': r.title || '',
            'URL': r.url || '',
            'Channel Name': r.channel_name || '',
            'Views': r.views || 0,
            'Date Published': r.date_published || '',
            'Thumbnail': r.thumbnail || '',
            'Summary': r.summary || '',
            'Video Key': r.video_key || '',
            'Channel Status': r.channel_status || 'normal',
            'Used': Boolean(r.is_used),
            'Search Rank': Number(r.search_rank || 0),
            'Facet Score': Number(r.facet_score || 0),
            'Facet Title Score': Number(r.facet_title_score || 0),
        }));

        return [formatted, result.totalCount, null, advancedSearchMeta];
    } catch (e) {
        console.error(`❌ Local DB Error: ${e.message}`);
        return [[], 0, e.message, advancedSearchMeta];
    }
}

/**
 * Get unique channel names from the local videos table.
 */
export async function getChannels() {
    await ensureUsageSchema();
    const db = getPool();
    try {
        const result = await db.query(
            `SELECT DISTINCT v.channel_name
             FROM videos v
             WHERE v.channel_name IS NOT NULL
               AND v.channel_name != ''
               AND NOT EXISTS (
                   SELECT 1
                   FROM channel_sources cs
                   WHERE cs.hidden IS TRUE
                     AND lower(cs.channel_name) = lower(v.channel_name)
               )
             ORDER BY v.channel_name`
        );
        return result.rows.map(r => r.channel_name);
    } catch (e) {
        console.error(`❌ Local DB Error (channels): ${e.message}`);
        return [];
    }
}

/**
 * Get search suggestions based on partial input.
 * Returns matching keywords (from FTS lexemes) and channel names.
 */
export async function getSuggestions(query) {
    const db = getPool();
    try {
        const lowerQuery = query.toLowerCase();
        const prefixPattern = `${lowerQuery}%`;

        // Only fetch keywords now
        const keywordResult = await db.query(
            `SELECT word, nentry 
             FROM ts_stat('SELECT fts_no_caption FROM videos') 
             WHERE word LIKE $1 AND length(word) >= 2
             ORDER BY nentry DESC 
             LIMIT 12`,
            [prefixPattern]
        );

        const suggestions = [];

        // Add keyword suggestions
        keywordResult.rows.forEach(r => {
            suggestions.push({
                text: r.word,
                type: 'keyword',
                count: r.nentry,
            });
        });

        return suggestions;
    } catch (e) {
        console.error(`❌ Local DB Error (suggestions): ${e.message}`);
        return [];
    }
}

/**
 * Preload the entire suggestion index for client-side filtering.
 * Returns all FTS lexemes (with counts).
 * Cached in server memory for 5 minutes to avoid repeated heavy queries.
 */
let _cachedIndex = null;
let _cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function preloadSuggestionIndex() {
    const now = Date.now();
    if (_cachedIndex && (now - _cacheTimestamp) < CACHE_TTL) {
        return _cachedIndex;
    }

    const db = getPool();
    try {
        const keywordResult = await db.query(
            `SELECT word, nentry 
             FROM ts_stat('SELECT fts_no_caption FROM videos') 
             WHERE length(word) >= 2
             ORDER BY nentry DESC 
             LIMIT 2000`
        );

        _cachedIndex = {
            keywords: keywordResult.rows.map(r => ({ text: r.word, count: r.nentry })),
        };
        _cacheTimestamp = now;

        return _cachedIndex;
    } catch (e) {
        console.error(`❌ Local DB Error (preload): ${e.message}`);
        return { keywords: [] };
    }
}


